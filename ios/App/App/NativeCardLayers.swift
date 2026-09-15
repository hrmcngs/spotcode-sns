import SwiftUI

private func layerColor(_ hex: String?) -> Color {
    let value = UInt32((hex ?? "#ffffff").replacingOccurrences(of: "#", with: ""), radix: 16) ?? 0xffffff
    return Color(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
}
private func layerName(_ kind: String) -> String {
    switch kind {
    case "name": return NSLocalizedString("名前", comment: "")
    case "title": return NSLocalizedString("肩書き", comment: "")
    case "bio": return NSLocalizedString("自己紹介", comment: "")
    case "contact": return NSLocalizedString("連絡先", comment: "")
    case "image": return NSLocalizedString("画像", comment: "")
    case "links": return NSLocalizedString("リンク", comment: "")
    case "backLabel": return NSLocalizedString("裏の見出し", comment: "")
    default: return NSLocalizedString("表の見出し", comment: "")
    }
}

struct BusinessCardLayerCanvas: View {
    let card: BusinessCard
    let side: String
    var selected: String? = nil
    var onSelect: ((String) -> Void)? = nil
    var onMove: ((String, Double, Double) -> Void)? = nil
    private var design: BusinessCardDesign { (card.design ?? BusinessCardDesign()).resolved(theme: card.effectiveTheme, layout: card.layout) }
    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .topLeading) {
                ForEach(Array((design.layers ?? []).enumerated()), id: \.element.id) { index, layer in
                    if layer.side == side && (!layer.hidden || onMove != nil) {
                        LayerCell(card: card, layer: layer, canvas: geometry.size, selected: selected == layer.id,
                                  onSelect: onSelect, onMove: onMove)
                            .zIndex(Double(index))
                    }
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .clipped()
            .coordinateSpace(name: "cardLayerCanvas")
        }
    }
}

private struct LayerCell: View {
    let card: BusinessCard
    let layer: BusinessCardLayer
    let canvas: CGSize
    let selected: Bool
    let onSelect: ((String) -> Void)?
    let onMove: ((String, Double, Double) -> Void)?
    @GestureState private var drag = CGSize.zero
    private var d: BusinessCardDesign { (card.design ?? BusinessCardDesign()).resolved(theme: card.effectiveTheme, layout: card.layout) }
    private var text: String {
        switch layer.kind {
        case "name": return card.name
        case "title": return card.title
        case "bio": return card.bio
        case "contact": return card.contact
        case "frontLabel": return d.frontLabel ?? ""
        case "backLabel": return d.backLabel ?? ""
        default: return ""
        }
    }
    @ViewBuilder private var content: some View {
        if layer.kind == "image" {
            if let image = card.image_url, !image.isEmpty {
                if onMove == nil, let link = BusinessCardLink.webURL(card.image_link ?? "") {
                    Link(destination: link) { DataURLImage(value: image, fit: true) }
                } else { DataURLImage(value: image, fit: true) }
            } else if onMove != nil { Image(systemName: "photo").resizable().scaledToFit().padding(4) }
        } else if layer.kind == "links" {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array((card.links ?? []).prefix(3).enumerated()), id: \.offset) { _, link in
                    if onMove == nil, let url = link.destination {
                        Link(link.label.isEmpty ? link.url : link.label, destination: url)
                    } else { Text(verbatim: link.label.isEmpty ? link.url : link.label) }
                }
            }
        } else {
            Text(verbatim: text).fontWeight(layer.kind == "name" ? .bold : .regular)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
    // Saved dimensions cap wrapping; text selection follows the rendered content.
    private var contentSize: CGSize {
        let maximum = CGSize(width: canvas.width * layer.width / 100, height: canvas.height * layer.height / 100)
        guard layer.kind != "image" else { return maximum }
        let lines = layer.kind == "links"
            ? (card.links ?? []).prefix(3).map { $0.label.isEmpty ? $0.url : $0.label }
            : [text]
        let size = layer.fontSize * canvas.width / (d.orientation == "portrait" ? 208 : 344)
        let style: UIFontDescriptor.SystemDesign = d.font == "mono" ? .monospaced : d.font == "serif" ? .serif : .default
        let base = UIFont.systemFont(ofSize: size, weight: layer.kind == "name" ? .bold : .regular)
        let font = UIFont(descriptor: base.fontDescriptor.withDesign(style) ?? base.fontDescriptor, size: size)
        let bounds = lines.map { line in
            (line.isEmpty ? " " : line).boundingRect(
                with: CGSize(width: maximum.width, height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font], context: nil)
        }
        return CGSize(width: min(maximum.width, max(12, ceil(bounds.map(\.width).max() ?? 0) + 2)),
                      height: min(maximum.height, max(font.lineHeight, ceil(bounds.reduce(0) { $0 + $1.height }) + Double(max(0, bounds.count - 1)) * 2)))
    }
    private var item: some View {
        content
            .font(.system(size: layer.fontSize * canvas.width / (d.orientation == "portrait" ? 208 : 344),
                          design: d.font == "mono" ? .monospaced : d.font == "serif" ? .serif : .default))
            .foregroundColor(layerColor(layer.kind.hasSuffix("Label") ? d.accentColor : d.textColor))
            .frame(width: contentSize.width, height: contentSize.height, alignment: .topLeading)
            .clipped()
            .overlay(Rectangle().stroke(selected ? Color.accentColor : .clear, style: StrokeStyle(lineWidth: 1, dash: layer.locked ? [3] : [])))
            .opacity(layer.hidden ? 0.25 : 1)
    }
    var body: some View {
        Group {
        if onMove != nil {
            item.contentShape(Rectangle())
                .onTapGesture { onSelect?(layer.id) }
                .highPriorityGesture(DragGesture(minimumDistance: 0, coordinateSpace: .named("cardLayerCanvas"))
                    .updating($drag) { value, state, _ in if !layer.locked { state = value.translation } }
                    .onEnded { value in
                        guard !layer.locked, canvas.width > 0, canvas.height > 0 else { return }
                        guard value.translation != .zero else { onSelect?(layer.id); return }
                        onSelect?(layer.id)
                        onMove?(layer.id, layer.x + value.translation.width / canvas.width * 100,
                                layer.y + value.translation.height / canvas.height * 100)
                    })
                .accessibilityLabel(layerName(layer.kind))
        } else { item }
        }
        .rotationEffect(.degrees(layer.rotation))
        .position(x: canvas.width * layer.x / 100 + contentSize.width / 2 + drag.width,
                  y: canvas.height * layer.y / 100 + contentSize.height / 2 + drag.height)
    }
}

struct BusinessCardLayerEditor: View {
    @Binding var card: BusinessCard
    @State private var side = "front"
    @State private var selected = "name"
    @State private var undo: [[BusinessCardLayer]?] = []
    @State private var redo: [[BusinessCardLayer]?] = []
    private var layers: [BusinessCardLayer]? { card.design?.layers }
    private var editableLayers: [BusinessCardLayer] { layers ?? BusinessCardLayer.defaults(card: card) }
    private var canvasCard: BusinessCard {
        var preview = card
        var design = card.design ?? BusinessCardDesign()
        design.layers = editableLayers; preview.design = design
        return preview
    }
    private var selectedLayer: BusinessCardLayer? { editableLayers.first { $0.id == selected } }
    private var dimensions: CGSize { card.design?.orientation == "portrait" ? CGSize(width: 55, height: 91) : CGSize(width: 91, height: 55) }
    private func set(_ value: [BusinessCardLayer]?) {
        undo.append(layers); if undo.count > 40 { undo.removeFirst() }; redo = []
        var d = card.design ?? BusinessCardDesign(); d.layers = value; card.design = d
    }
    private func update(_ id: String, _ change: (inout BusinessCardLayer) -> Void) {
        var next = editableLayers
        guard let index = next.firstIndex(where: { $0.id == id }) else { return }
        change(&next[index]); next[index] = next[index].normalized; set(next)
    }
    private func history(back: Bool) {
        var d = card.design ?? BusinessCardDesign()
        if back { guard !undo.isEmpty else { return }; redo.append(layers); d.layers = undo.removeLast() }
        else { guard !redo.isEmpty else { return }; undo.append(layers); d.layers = redo.removeLast() }
        card.design = d
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 12) {
                    Picker(NSLocalizedString("編集する面", comment: ""), selection: $side) {
                        Text(NSLocalizedString("表", comment: "")).tag("front"); Text(NSLocalizedString("裏", comment: "")).tag("back")
                    }.pickerStyle(.segmented)
                    BusinessCardLayerCanvas(card: canvasCard, side: side, selected: selected,
                        onSelect: { selected = $0 }, onMove: { id, x, y in update(id) { $0.x = x; $0.y = y } })
                        .aspectRatio(dimensions.width / dimensions.height, contentMode: .fit)
                        .background(BusinessCardLayerBackground(card: card, back: side == "back"))
                        .clipShape(BusinessCardOutline(radius: CGFloat(card.design?.radius ?? 18), style: card.design?.cornerStyle ?? "rounded"))
                        .overlay(Rectangle().stroke(.secondary))
                    Text(NSLocalizedString("レイヤーを選んでドラッグ。数値は名刺上のmmです。変更後は保存してください。", comment: "")).font(.caption)
                    HStack {
                        Button(NSLocalizedString("元に戻す", comment: "")) { history(back: true) }.disabled(undo.isEmpty)
                        Button(NSLocalizedString("やり直す", comment: "")) { history(back: false) }.disabled(redo.isEmpty)
                    }
                    Picker(NSLocalizedString("レイヤー", comment: ""), selection: $selected) {
                        ForEach(editableLayers.filter { $0.side == side }.reversed()) { layer in Text(layerName(layer.kind)).tag(layer.id) }
                    }.pickerStyle(.menu)
                    if let layer = selectedLayer, layer.side == side {
                        Toggle(NSLocalizedString("ロック", comment: ""), isOn: Binding(get: { layer.locked }, set: { value in update(selected) { $0.locked = value } }))
                        Toggle(NSLocalizedString("非表示", comment: ""), isOn: Binding(get: { layer.hidden }, set: { value in update(selected) { $0.hidden = value } }))
                        VStack {
                            number("X (mm)", \.x, axis: dimensions.width)
                            number("Y (mm)", \.y, axis: dimensions.height)
                            number(NSLocalizedString("幅 (mm)", comment: ""), \.width, axis: dimensions.width)
                            number(NSLocalizedString("高さ (mm)", comment: ""), \.height, axis: dimensions.height)
                            number(NSLocalizedString("回転 (°)", comment: ""), \.rotation)
                            if layer.kind != "image" { number(NSLocalizedString("文字サイズ", comment: ""), \.fontSize) }
                            HStack {
                                Button(NSLocalizedString("前面へ", comment: "")) { reorder(front: true) }
                                Button(NSLocalizedString("背面へ", comment: "")) { reorder(front: false) }
                                Button(NSLocalizedString("中央に配置", comment: "")) { update(selected) { $0.x = (100 - $0.width) / 2; $0.y = (100 - $0.height) / 2 } }
                            }
                        }.disabled(layer.locked)
                    }
                    Button(NSLocalizedString("自動配置に戻す", comment: "")) { set(nil) }.disabled(layers == nil)
            }.padding(.vertical, 8)
        }.onChange(of: side) { value in selected = editableLayers.first { $0.side == value }?.id ?? "name" }
    }
    private func number(_ title: String, _ key: WritableKeyPath<BusinessCardLayer, Double>, axis: Double = 100) -> some View {
        HStack {
            Text(title)
            Spacer()
            TextField(title, value: Binding(get: { (selectedLayer?[keyPath: key] ?? 0) * axis / 100 },
                set: { value in update(selected) { $0[keyPath: key] = value / axis * 100 } }), format: .number.precision(.fractionLength(0...2)))
                .multilineTextAlignment(.trailing).frame(width: 90).textFieldStyle(.roundedBorder)
        }
    }
    private func reorder(front: Bool) {
        var next = editableLayers
        guard let index = next.firstIndex(where: { $0.id == selected }) else { return }
        let layer = next.remove(at: index)
        if front { next.append(layer) } else { next.insert(layer, at: 0) }; set(next)
    }
}

struct BusinessCardLayerBackground: View {
    let card: BusinessCard
    let back: Bool
    private var d: BusinessCardDesign { (card.design ?? BusinessCardDesign()).resolved(theme: card.effectiveTheme, layout: card.layout) }
    var body: some View {
        let front = layerColor(d.frontColor), rear = layerColor(d.backColor)
        return ZStack {
            if d.pattern == "gradient" {
                LinearGradient(colors: back ? [rear, front] : [front, rear], startPoint: .topLeading, endPoint: .bottomTrailing)
                if card.effectiveTheme == "aurora" {
                    RadialGradient(colors: [rear, .clear], center: .topTrailing, startRadius: 0, endRadius: 360)
                }
            } else { back ? rear : front }
            if card.effectiveTheme == "ghost" && d.pattern != "solid" {
                RadialGradient(colors: [.white.opacity(0.65), .clear], center: .topLeading, startRadius: 0, endRadius: 300)
            }
            if d.pattern != "solid", let symbol = ["spring":"leaf", "summer":"sun.max", "autumn":"leaf.fill", "winter":"snowflake"][card.effectiveTheme] {
                VStack { HStack { Spacer(); Image(systemName: symbol).font(.system(size: 72)).opacity(0.12) }; Spacer() }.padding(22)
                    .foregroundColor(layerColor(d.accentColor)).allowsHitTesting(false).accessibilityHidden(true)
            }
            if d.pattern == "stripe" {
                GeometryReader { geometry in
                    Path { path in
                        for x in stride(from: -geometry.size.height, to: geometry.size.width, by: 24) {
                            path.move(to: CGPoint(x: x, y: geometry.size.height))
                            path.addLine(to: CGPoint(x: x + geometry.size.height, y: 0))
                        }
                    }.stroke(Color.white.opacity(0.06), lineWidth: 2)
                }
            }
        }
    }
}
