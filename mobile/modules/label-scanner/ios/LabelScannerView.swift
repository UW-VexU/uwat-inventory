import AVFoundation
import ExpoModulesCore
import VisionKit

/// Apple's live scanner, inside the board screen. It picks the lens, focuses close and
/// steadies the picture on its own, which the small square codes on parts bags need.
final class LabelScannerView: ExpoView, DataScannerViewControllerDelegate {
  let onCode = EventDispatcher()
  let onProblem = EventDispatcher()

  private let scanner = DataScannerViewController(
    recognizedDataTypes: [.barcode(symbologies: LabelReader.symbologies)],
    // Accurate is Apple's setting for small or dense codes, which these are.
    qualityLevel: .accurate,
    recognizesMultipleItems: true,
    isHighFrameRateTrackingEnabled: false,
    isPinchToZoomEnabled: true,
    isGuidanceEnabled: true,
    isHighlightingEnabled: true
  )
  /// What was last sent for each code in view, so a code held still isn't sent many times a second.
  private var sent: [UUID: String] = [:]
  private var torch = false
  private var zoomed = false
  private var normalZoom: Double?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
    scanner.delegate = self
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil else {
      scanner.stopScanning()
      scanner.willMove(toParent: nil)
      scanner.view.removeFromSuperview()
      scanner.removeFromParent()
      sent.removeAll()
      return
    }
    if scanner.parent == nil, let parent = parentController() {
      parent.addChild(scanner)
      scanner.view.frame = bounds
      addSubview(scanner.view)
      scanner.didMove(toParent: parent)
    }
    // Start once the scanner's view is on screen, as Apple asks.
    DispatchQueue.main.async { [weak self] in self?.start() }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    scanner.view.frame = bounds
  }

  func setTorch(_ on: Bool) {
    torch = on
    applyTorch()
  }

  func setZoomed(_ on: Bool) {
    zoomed = on
    applyZoom()
  }

  private func start() {
    guard window != nil, !scanner.isScanning else { return }
    guard DataScannerViewController.isAvailable else {
      onProblem(["message": "The camera isn't available. Check camera access for this app in Settings."])
      return
    }
    do {
      try scanner.startScanning()
    } catch {
      onProblem(["message": "The scanner couldn't start: \(error.localizedDescription)"])
      return
    }
    if normalZoom == nil { normalZoom = scanner.zoomFactor }
    applyZoom()
    applyTorch()
  }

  private func applyZoom() {
    guard scanner.isScanning, let normalZoom else { return }
    scanner.zoomFactor = zoomed ? min(scanner.maxZoomFactor, normalZoom * 2) : normalZoom
  }

  private func applyTorch() {
    guard scanner.isScanning, let device = AVCaptureDevice.default(for: .video), device.hasTorch,
      (try? device.lockForConfiguration()) != nil else { return }
    device.torchMode = torch ? .on : .off
    device.unlockForConfiguration()
  }

  private func parentController() -> UIViewController? {
    var responder: UIResponder? = self
    while let next = responder?.next {
      if let controller = next as? UIViewController { return controller }
      responder = next
    }
    return nil
  }

  private func report(_ items: [RecognizedItem]) {
    for case let .barcode(code) in items {
      guard let data = LabelReader.text(of: code.observation), sent[code.id] != data else { continue }
      sent[code.id] = data
      onCode(["data": data, "type": LabelReader.typeName(code.observation.symbology)])
    }
  }

  // MARK: DataScannerViewControllerDelegate

  func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
    report(addedItems)
  }

  // A code is often found before it can be read, so its text arrives in a later update.
  func dataScanner(_ dataScanner: DataScannerViewController, didUpdate updatedItems: [RecognizedItem], allItems: [RecognizedItem]) {
    report(updatedItems)
  }

  func dataScanner(_ dataScanner: DataScannerViewController, didRemove removedItems: [RecognizedItem], allItems: [RecognizedItem]) {
    for item in removedItems { sent[item.id] = nil }
  }

  func dataScanner(_ dataScanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
    onProblem(["message": "The scanner stopped: \(error.localizedDescription)"])
  }
}
