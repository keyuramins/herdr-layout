// Studio Dictation: listens with the newest speech recognition this Mac has
// and writes what it hears to files the Studio composer reads.
//
//   StudioDictation <session folder>
//
// Engine, picked by itself, newest first:
//   1. SpeechTranscriber + SpeechAnalyzer (macOS 26 and later, built with a
//      macOS 26 SDK): Apple's current on-device engine, the one behind the
//      latest Dictation. Its language model downloads once if missing.
//   2. SFSpeechRecognizer: Apple's older engine, for older Macs, older SDKs,
//      or a language the new engine doesn't have.
//
// In the session folder it writes:
//   engine       speech-transcriber | sf-speech-recognizer
//   status       starting | downloading | listening | finishing | done |
//                nothing | denied-mic | denied-speech | unavailable |
//                no-microphone
//   partial.txt  everything heard so far, rewritten as it changes
//   final.txt    everything heard, once it's finished
// It stops when a file named "stop" appears there, after 3s with no new
// words and no typing once you've spoken, after 10s with nothing said, or
// after 60s. Studio touches a file named "active" there while you type or
// delete in the box, which counts as activity: editing doesn't end it.
//
// Words are only ever added: a result that comes back empty or shorter
// (engines do that as they settle, or start a new sentence after a pause)
// never erases what was already heard.
//
// It's an app bundle so macOS asks for the microphone (and, for the older
// engine, speech recognition) in its own name: Herdr declares neither.

import AppKit
import AVFoundation
import Speech

let session = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : NSTemporaryDirectory(), isDirectory: true)
let maxSeconds: TimeInterval = 60
let silenceSeconds: TimeInterval = 3.0
let quietStartSeconds: TimeInterval = 10

// Words that come up when talking to a coding agent: a nudge for the
// recognizer, not a limit on what it hears.
let hints = [
    "field", "fields", "cart", "commit", "branch", "merge", "rebase", "refactor", "function", "component",
    "endpoint", "API", "README", "TypeScript", "JavaScript", "JSON", "config", "test", "tests", "diff",
    "pull request", "repo", "deploy", "staging", "worktree", "Claude", "Codex", "Herdr", "npm", "git",
]

func put(_ name: String, _ text: String) {
    try? text.write(to: session.appendingPathComponent(name), atomically: true, encoding: .utf8)
}

// What's been heard: finished sentences, plus the one still being heard.
final class Words {
    private var settled = ""
    private var current = ""
    private(set) var heard = false
    private(set) var lastChange = Date()

    var text: String {
        [settled, current].filter { !$0.isEmpty }.joined(separator: " ")
    }

    // A sentence the engine has finished with.
    func settle(_ words: String) {
        let w = words.trimmingCharacters(in: .whitespacesAndNewlines)
        current = ""
        guard !w.isEmpty else { return publish() }
        settled = settled.isEmpty ? w : "\(settled) \(w)"
        publish()
    }

    // The sentence still being heard. Empty means "nothing new yet", never
    // "forget it"; a much shorter one that doesn't continue it is a new
    // sentence after a pause, so the last one is kept.
    func hearing(_ words: String) {
        let w = words.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !w.isEmpty, w != current else { return }
        if !current.isEmpty && !w.lowercased().hasPrefix(String(current.lowercased().prefix(3))) && w.count < current.count / 2 {
            settle(current)
        }
        current = w
        publish()
    }

    private func publish() {
        let t = text
        if t.isEmpty { return }
        heard = true
        lastChange = Date()
        put("partial.txt", t)
    }
}

let words = Words()
var finished = false

func finish(_ status: String) {
    guard !finished else { return }
    finished = true
    let t = words.text
    put("final.txt", t)
    put("status", t.isEmpty && status == "done" ? "nothing" : status)
    exit(0)
}

// When you last typed or deleted in the composer (Studio touches "active").
func lastEdit() -> Date? {
    let path = session.appendingPathComponent("active").path
    return (try? FileManager.default.attributesOfItem(atPath: path))?[.modificationDate] as? Date
}

// Stop when asked, after a pause in both talking and typing, or when it's been too long.
func shouldStop(started: Date) -> Bool {
    let now = Date()
    if FileManager.default.fileExists(atPath: session.appendingPathComponent("stop").path) { return true }
    let edit = lastEdit() ?? .distantPast
    let activity = max(words.lastChange, edit)
    if words.heard && now.timeIntervalSince(activity) > silenceSeconds { return true }
    if !words.heard && now.timeIntervalSince(max(started, edit)) > quietStartSeconds { return true }
    return now.timeIntervalSince(started) > maxSeconds
}

// ---- 1. The new engine (macOS 26) ------------------------------------------

#if compiler(>=6.2)
@available(macOS 26.0, *)
final class ModernListener {
    let engine = AVAudioEngine()
    var analyzer: SpeechAnalyzer?
    var input: AsyncStream<AnalyzerInput>.Continuation?
    var results: Task<Void, Never>?
    var timer: Timer?
    var started = Date()
    var ending = false

    // Nil when this Mac's new engine can't take the language: the older one takes over.
    static func supportedLocale() async -> Locale? {
        guard SpeechTranscriber.isAvailable else { return nil }
        return await SpeechTranscriber.supportedLocale(equivalentTo: Locale.current)
    }

    func run(locale: Locale) async throws {
        put("engine", "speech-transcriber")
        let transcriber = SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults], attributeOptions: [])
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            put("status", "downloading")
            try await request.downloadAndInstall()
        }
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        self.analyzer = analyzer
        let context = AnalysisContext()
        context.contextualStrings[.general] = hints
        try? await analyzer.setContext(context)

        let mic = engine.inputNode
        let micFormat = mic.outputFormat(forBus: 0)
        guard micFormat.channelCount > 0 else { return finish("no-microphone") }
        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber], considering: micFormat) else {
            throw NSError(domain: "StudioDictation", code: 1)
        }
        try await analyzer.prepareToAnalyze(in: format)

        let (stream, input) = AsyncStream<AnalyzerInput>.makeStream()
        self.input = input
        let converter = micFormat == format ? nil : AVAudioConverter(from: micFormat, to: format)
        mic.installTap(onBus: 0, bufferSize: 4096, format: micFormat) { buffer, _ in
            guard let converter = converter else {
                input.yield(AnalyzerInput(buffer: buffer))
                return
            }
            let ratio = format.sampleRate / micFormat.sampleRate
            let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1
            guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return }
            var fed = false
            var error: NSError?
            converter.convert(to: out, error: &error) { _, status in
                if fed {
                    status.pointee = .noDataNow
                    return nil
                }
                fed = true
                status.pointee = .haveData
                return buffer
            }
            if error == nil && out.frameLength > 0 { input.yield(AnalyzerInput(buffer: out)) }
        }

        results = Task { @MainActor in
            do {
                for try await result in transcriber.results {
                    let text = String(result.text.characters)
                    if result.isFinal { words.settle(text) } else { words.hearing(text) }
                }
            } catch {}
        }

        try await analyzer.start(inputSequence: stream)
        engine.prepare()
        try engine.start()
        started = Date()
        put("status", "listening")
        timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            guard let self = self, !self.ending, shouldStop(started: self.started) else { return }
            Task { @MainActor in await self.end() }
        }
    }

    // Stop the microphone, let the engine finish its last sentence, then report.
    @MainActor
    func end() async {
        guard !ending else { return }
        ending = true
        timer?.invalidate()
        put("status", "finishing")
        // Whatever the engine does next, report what was heard within 3 seconds.
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { finish("done") }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        input?.finish()
        try? await analyzer?.finalizeAndFinishThroughEndOfInput()
        // The results loop ends once the analyzer has finished; don't wait forever.
        let waited = Task { await self.results?.value }
        let deadline = Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            waited.cancel()
        }
        _ = await waited.value
        deadline.cancel()
        finish("done")
    }
}
#endif

// ---- 2. The older engine ---------------------------------------------------

final class LegacyListener {
    let engine = AVAudioEngine()
    let request = SFSpeechAudioBufferRecognitionRequest()
    var task: SFSpeechRecognitionTask?
    var started = Date()
    var ending = false
    var timer: Timer?

    func begin() {
        put("engine", "sf-speech-recognizer")
        guard let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
              recognizer.isAvailable else {
            return finish("unavailable")
        }
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        request.contextualStrings = hints
        if #available(macOS 13, *) { request.addsPunctuation = true }

        let mic = engine.inputNode
        let format = mic.outputFormat(forBus: 0)
        guard format.channelCount > 0 else { return finish("no-microphone") }
        let request = self.request
        mic.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            return finish("no-microphone")
        }

        started = Date()
        put("status", "listening")
        task = recognizer.recognitionTask(with: request) { result, error in
            DispatchQueue.main.async {
                if let result = result {
                    let text = result.bestTranscription.formattedString
                    if result.isFinal { words.settle(text) } else { words.hearing(text) }
                    if result.isFinal && self.ending { finish("done") }
                } else if error != nil {
                    finish("done")
                }
            }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            guard let self = self, !self.ending, shouldStop(started: self.started) else { return }
            self.end()
        }
    }

    func end() {
        guard !ending else { return }
        ending = true
        timer?.invalidate()
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request.endAudio()
        put("status", "finishing")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { finish("done") }
    }
}

// ---- Start -----------------------------------------------------------------

var legacy: LegacyListener?
var modern: AnyObject?

func startLegacy() {
    SFSpeechRecognizer.requestAuthorization { status in
        DispatchQueue.main.async {
            guard status == .authorized else { return finish("denied-speech") }
            let l = LegacyListener()
            legacy = l
            l.begin()
        }
    }
}

func startNewest() {
    #if compiler(>=6.2)
    if #available(macOS 26.0, *) {
        Task { @MainActor in
            guard let locale = await ModernListener.supportedLocale() else { return startLegacy() }
            let m = ModernListener()
            modern = m
            do {
                try await m.run(locale: locale)
            } catch {
                // The new engine couldn't start here (its model, its format): use the older one.
                if !m.ending {
                    m.engine.stop()
                    m.engine.inputNode.removeTap(onBus: 0)
                    modern = nil
                    startLegacy()
                }
            }
        }
        return
    }
    #endif
    startLegacy()
}

put("status", "starting")
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
DispatchQueue.main.async {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized:
        startNewest()
    case .notDetermined:
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            DispatchQueue.main.async { granted ? startNewest() : finish("denied-mic") }
        }
    default:
        finish("denied-mic")
    }
}
app.run()
