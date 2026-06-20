import UIKit
import Social
import MobileCoreServices
import UniformTypeIdentifiers

// Headless Share Extension: when the user taps "Rally" in Instagram's share
// sheet, this grabs the shared link (or text containing a link), hands it off
// to the main app via the `rally://share?...` custom URL scheme, and dismisses
// immediately — no compose UI.
//
// The main app's web layer (useShareDeepLink.js) catches that deep link and
// routes to /share, where the reel is saved as an itinerary activity.
class ShareViewController: UIViewController {

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        extractSharedURL { [weak self] url, title in
            guard let self = self else { return }
            if let url = url {
                self.handOff(url: url, title: title)
            }
            self.finish()
        }
    }

    // Pull the first web URL we can find from the extension's input items —
    // either a real URL attachment or a URL embedded in shared text.
    private func extractSharedURL(completion: @escaping (URL?, String?) -> Void) {
        let urlType = UTType.url.identifier
        let textType = UTType.text.identifier

        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            completion(nil, nil); return
        }

        for item in items {
            guard let providers = item.attachments else { continue }
            for provider in providers {
                if provider.hasItemConformingToTypeIdentifier(urlType) {
                    provider.loadItem(forTypeIdentifier: urlType, options: nil) { data, _ in
                        let url = data as? URL
                        DispatchQueue.main.async { completion(url, item.attributedContentText?.string) }
                    }
                    return
                }
            }
            // Fall back to scanning shared text for a URL (Instagram sometimes
            // shares the link as plain text rather than a URL attachment).
            for provider in providers {
                if provider.hasItemConformingToTypeIdentifier(textType) {
                    provider.loadItem(forTypeIdentifier: textType, options: nil) { data, _ in
                        let text = (data as? String) ?? ""
                        let url = Self.firstURL(in: text)
                        DispatchQueue.main.async { completion(url, text) }
                    }
                    return
                }
            }
        }
        completion(nil, nil)
    }

    private static func firstURL(in text: String) -> URL? {
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        let range = NSRange(text.startIndex..., in: text)
        if let match = detector?.firstMatch(in: text, options: [], range: range) {
            return match.url
        }
        return nil
    }

    private func handOff(url: URL, title: String?) {
        var components = URLComponents()
        components.scheme = "rally"
        components.host = "share"
        var query = [URLQueryItem(name: "url", value: url.absoluteString)]
        if let title = title, !title.isEmpty {
            query.append(URLQueryItem(name: "title", value: title))
        }
        components.queryItems = query
        guard let deepLink = components.url else { return }
        openHostApp(deepLink)
    }

    // Extensions can't call UIApplication.shared.open directly, so walk the
    // responder chain to reach the shared application and invoke open(_:).
    private func openHostApp(_ url: URL) {
        var responder: UIResponder? = self
        let selector = sel_registerName("openURL:")
        while let r = responder {
            if r.responds(to: selector) {
                r.perform(selector, with: url)
                return
            }
            responder = r.next
        }
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
