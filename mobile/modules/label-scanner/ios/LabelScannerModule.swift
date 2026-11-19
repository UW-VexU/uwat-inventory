import ExpoModulesCore
import PhotosUI
import VisionKit

public final class LabelScannerModule: Module {
  private var photoPick: PhotoPick?

  public func definition() -> ModuleDefinition {
    Name("LabelScanner")

    /// Apple's live scanner needs an A12 chip or newer (iPhone XS on).
    AsyncFunction("isLiveScanSupported") { () async -> Bool in
      await MainActor.run { DataScannerViewController.isSupported }
    }

    /// Lets someone pick a photo and reads the label codes in it. Null when they cancel.
    AsyncFunction("scanPhoto") { () async throws -> [[String: String]]? in
      guard let (image, orientation) = try await self.pickPhoto() else { return nil }
      return try await Task.detached(priority: .userInitiated) {
        try LabelReader.read(image, orientation: orientation)
      }.value
    }

    View(LabelScannerView.self) {
      Events("onCode", "onProblem")

      Prop("torch") { (view: LabelScannerView, on: Bool) in
        view.setTorch(on)
      }

      Prop("zoomed") { (view: LabelScannerView, on: Bool) in
        view.setZoomed(on)
      }
    }
  }

  @MainActor
  private func pickPhoto() async throws -> (CGImage, CGImagePropertyOrientation)? {
    guard let presenter = appContext?.utilities?.currentViewController() else {
      throw Exception(name: "NoScreen", description: "There's no screen to show the photo picker on.")
    }
    let image: UIImage? = await withCheckedContinuation { continuation in
      let pick = PhotoPick(continuation: continuation)
      photoPick = pick
      pick.present(from: presenter)
    }
    photoPick = nil
    guard let image else { return nil }
    if let cgImage = image.cgImage {
      return (cgImage, CGImagePropertyOrientation(image.imageOrientation))
    }
    // Some images arrive without a bitmap behind them; drawing one gives Vision something to read.
    guard let drawn = UIGraphicsImageRenderer(size: image.size).image(actions: { _ in image.draw(at: .zero) }).cgImage else {
      return nil
    }
    return (drawn, .up)
  }
}

private final class PhotoPick: NSObject, PHPickerViewControllerDelegate {
  private var continuation: CheckedContinuation<UIImage?, Never>?

  init(continuation: CheckedContinuation<UIImage?, Never>) {
    self.continuation = continuation
  }

  @MainActor
  func present(from presenter: UIViewController) {
    var configuration = PHPickerConfiguration()
    configuration.filter = .images
    configuration.selectionLimit = 1
    let picker = PHPickerViewController(configuration: configuration)
    picker.delegate = self
    presenter.present(picker, animated: true)
  }

  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    guard let provider = results.first?.itemProvider, provider.canLoadObject(ofClass: UIImage.self) else {
      finish(nil)
      return
    }
    provider.loadObject(ofClass: UIImage.self) { [self] object, _ in
      finish(object as? UIImage)
    }
  }

  private func finish(_ image: UIImage?) {
    continuation?.resume(returning: image)
    continuation = nil
  }
}
