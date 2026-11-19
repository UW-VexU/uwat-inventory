import CoreML
import ImageIO
import UIKit
import Vision

/// Apple Vision reads DigiKey's square labels with the separators intact, from photos and live.
enum LabelReader {
  /// No 1D codes: the long barcodes on a bag hold a shipping tote and a label number, never the part.
  static let symbologies: [VNBarcodeSymbology] = [.dataMatrix, .qr]

  static func typeName(_ symbology: VNBarcodeSymbology) -> String {
    switch symbology {
    case .dataMatrix: return "datamatrix"
    case .qr: return "qr"
    default: return symbology.rawValue
    }
  }

  static func text(of observation: VNBarcodeObservation) -> String? {
    guard let text = observation.payloadStringValue, !text.isEmpty else { return nil }
    return text
  }

  /// Every label code in a still image, each once. Vision's newest reader goes first; the older
  /// ones only run when it finds nothing, since they sometimes read a photo it misses.
  static func read(_ image: CGImage, orientation: CGImagePropertyOrientation) throws -> [[String: String]] {
    let newest = VNDetectBarcodesRequest.currentRevision
    let older = VNDetectBarcodesRequest.supportedRevisions.filter { $0 != newest }.sorted(by: >)
    for revision in [newest] + older {
      let codes = try read(image, orientation: orientation, revision: revision)
      if !codes.isEmpty { return codes }
    }
    return []
  }

  private static func read(_ image: CGImage, orientation: CGImagePropertyOrientation, revision: Int) throws -> [[String: String]] {
    let request = VNDetectBarcodesRequest()
    request.revision = revision
    request.symbologies = symbologies
    #if targetEnvironment(simulator)
    // The simulator has no Neural Engine, and Vision fails rather than fall back on its own.
    if #available(iOS 17.0, *), let cpu = try request.supportedComputeStageDevices[.main]?.first(where: {
      if case .cpu = $0 { return true }
      return false
    }) {
      request.setComputeDevice(cpu, for: .main)
    }
    #endif
    try VNImageRequestHandler(cgImage: image, orientation: orientation).perform([request])
    var seen = Set<String>()
    return (request.results ?? []).compactMap { observation in
      guard let data = text(of: observation), seen.insert(data).inserted else { return nil }
      return ["data": data, "type": typeName(observation.symbology)]
    }
  }
}

extension CGImagePropertyOrientation {
  init(_ orientation: UIImage.Orientation) {
    switch orientation {
    case .up: self = .up
    case .upMirrored: self = .upMirrored
    case .down: self = .down
    case .downMirrored: self = .downMirrored
    case .left: self = .left
    case .leftMirrored: self = .leftMirrored
    case .right: self = .right
    case .rightMirrored: self = .rightMirrored
    @unknown default: self = .up
    }
  }
}
