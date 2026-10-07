import SwiftUI

struct CanvasRepresentable: NSViewRepresentable {
    let controller: EditorController
    var insets: EdgeInsets

    func makeNSView(context: Context) -> CanvasView {
        let view = CanvasView(frame: .zero)
        view.controller = controller
        view.setAccessibilityRole(.layoutArea)
        view.setAccessibilityLabel("Canvas")
        return view
    }

    func updateNSView(_ view: CanvasView, context: Context) {
        view.controller = controller
        view.contentInsets = NSEdgeInsets(top: insets.top, left: insets.leading, bottom: insets.bottom, right: insets.trailing)
        // Reading these registers them with SwiftUI, which calls back here when they change.
        _ = controller.zoom
        _ = controller.slideFocusRequest
        _ = controller.editingTextLayerID
        _ = controller.cropLayerID
        _ = controller.selectedLayer?.image?.assetID
        _ = controller.project
        view.syncWithController()
    }

    static func dismantleNSView(_ view: CanvasView, coordinator: ()) {
        view.teardown()
    }
}
