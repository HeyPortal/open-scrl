import SwiftUI

/// Slides in posting order, floating over the bottom of the canvas.
struct FilmstripView: View {
    var controller: EditorController
    private let thumbHeight: CGFloat = 62

    var body: some View {
        let project = controller.project
        let thumbWidth = thumbHeight * project.format.aspectRatio
        let selectedIndex = controller.selectedSlideIndex
        let count = project.slides.count
        let revision = controller.document.images.revision

        HStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView(.horizontal) {
                    LazyHStack(alignment: .top, spacing: 10) {
                        ForEach(project.slides) { slide in
                            let index = project.slideIndex(of: slide.id) ?? 0
                            SlideCell(controller: controller, slide: slide, index: index, selected: index == selectedIndex,
                                      scene: SlideScene(project: project, index: index), revision: revision,
                                      size: CGSize(width: thumbWidth, height: thumbHeight))
                                .id(slide.id)
                        }
                        .reorderable()

                        Button { controller.addSlide(after: project.slides.last?.id) } label: {
                            VStack(spacing: 5) {
                                RoundedRectangle(cornerRadius: 7, style: .continuous)
                                    .strokeBorder(.secondary.opacity(0.5), style: StrokeStyle(lineWidth: 1.25, dash: [4, 3]))
                                    .frame(width: max(thumbWidth, 40), height: thumbHeight)
                                    .overlay { Image(systemName: "plus").font(.title3).foregroundStyle(.secondary) }
                                Text(" ").font(.caption2)
                            }
                        }
                        .buttonStyle(.plain)
                        .help("New Slide (⇧⌘N)")
                    }
                    .reorderContainer(for: SlideDragItem.self) { difference in
                        var order = project.slides.map(\.id)
                        let moving = order.filter { difference.sources.contains($0) }
                        order.removeAll { difference.sources.contains($0) }
                        switch difference.destination.position {
                        case .before(let id):
                            order.insert(contentsOf: moving, at: order.firstIndex(of: id) ?? order.count)
                        case .end:
                            order.append(contentsOf: moving)
                        }
                        controller.reorderSlides(order)
                    }
                    .dragContainer(for: SlideDragItem.self) { (ids: [String]) in
                        let snapshot = controller.project
                        return ids.filter { snapshot.slideIndex(of: $0) != nil }.map {
                            SlideDragItem(id: $0, project: snapshot, media: controller.document.media,
                                          name: controller.document.displayName)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                }
                .scrollIndicators(.never)
                .onChange(of: controller.selectedSlideID) { _, id in
                    withAnimation(.snappy) { proxy.scrollTo(id, anchor: .center) }
                }
            }

            Divider().padding(.vertical, 12)

            VStack(alignment: .leading, spacing: 6) {
                Text("Slide \(selectedIndex + 1) of \(count)")
                    .font(.callout.weight(.medium))
                    .monospacedDigit()
                HStack(spacing: 2) {
                    Button { controller.moveSelectedSlide(by: -1) } label: { Image(systemName: "chevron.left") }
                        .disabled(selectedIndex == 0).help("Move Slide Left")
                    Button { controller.moveSelectedSlide(by: 1) } label: { Image(systemName: "chevron.right") }
                        .disabled(selectedIndex >= count - 1).help("Move Slide Right")
                    Button { controller.duplicateSlide(controller.selectedSlideID) } label: { Image(systemName: "plus.square.on.square") }
                        .help("Duplicate Slide (⇧⌘D)")
                    Button { controller.deleteSlide(controller.selectedSlideID) } label: { Image(systemName: "trash") }
                        .disabled(count <= 1).help("Delete Slide")
                }
                .buttonStyle(.borderless)
                .controlSize(.large)
            }
            .padding(.horizontal, 14)
            .fixedSize()
        }
        .frame(height: thumbHeight + 40)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

private struct SlideCell: View {
    var controller: EditorController
    var slide: Slide
    var index: Int
    var selected: Bool
    var scene: SlideScene
    var revision: Int
    var size: CGSize

    var body: some View {
        let animated = scene.assets.values.contains { $0.mediaKind.isAnimated }
        VStack(spacing: 5) {
            SlideThumbnail(scene: scene, images: controller.document.images, revision: revision)
                .equatable()
                .frame(width: size.width, height: size.height)
                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .strokeBorder(selected ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary.opacity(0.14)), lineWidth: selected ? 2.5 : 1)
                }
                .overlay(alignment: .bottomTrailing) {
                    if animated {
                        Image(systemName: "play.fill")
                            .font(.system(size: 7, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(3)
                            .background(.black.opacity(0.55), in: Circle())
                            .padding(3)
                            .help("Exports as MP4")
                    }
                }
                .shadow(color: .black.opacity(0.12), radius: 2, y: 1)
            Text("\(index + 1)")
                .font(.caption2.weight(selected ? .bold : .regular))
                .monospacedDigit()
                .foregroundStyle(selected ? .primary : .secondary)
        }
        .contentShape(Rectangle())
        .help("Drag to reorder, or into Finder, Messages or Mail as a PNG")
        .onTapGesture { controller.focusSlide(slide.id) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Slide \(index + 1)")
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        .accessibilityAction { controller.focusSlide(slide.id) }
        .contextMenu {
            Button("New Slide After", systemImage: "plus.rectangle") { controller.addSlide(after: slide.id) }
            Button("Duplicate Slide", systemImage: "plus.rectangle.on.rectangle") { controller.duplicateSlide(slide.id) }
            Button("Delete Slide", systemImage: "trash", role: .destructive) { controller.deleteSlide(slide.id) }
                .disabled(controller.project.slides.count <= 1)
            Divider()
            Button("Move Left", systemImage: "arrow.left") { controller.moveSlide(from: index, to: index - 1) }.disabled(index == 0)
            Button("Move Right", systemImage: "arrow.right") { controller.moveSlide(from: index, to: index + 1) }
                .disabled(index >= controller.project.slides.count - 1)
            Divider()
            Button("Export Slide…", systemImage: "square.and.arrow.up") {
                controller.focusSlide(slide.id)
                controller.exportCurrentSlide()
            }
        }
    }
}
