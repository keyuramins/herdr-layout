// Studio Dictation: listens with the Mac's built-in speech recognition (the
// engine behind macOS Dictation, on-device when the Mac supports it) and
// writes what it hears to files the Studio composer reads.
//
//   StudioDictation <session folder>
//
// In the session folder it writes:
//   status       starting | listening | finishing | done | nothing |
//                denied-mic | denied-speech | unavailable | no-microphone
//   partial.txt  the words so far, rewritten as they change
//   final.txt    the words, once it's finished
// and it stops when a file named "stop" appears there, after 2s of silence
// once you've spoken, after 10s with nothing said, or after 60s.
//
// It's an app bundle (not a bare program) so macOS asks for the microphone
// and speech recognition in its own name: Herdr itself declares neither.

import AppKit
import AVFoundation
import Speech

let session = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : NSTemporaryDirectory(), isDirectory: true)
let maxSeconds: TimeInterval = 60
let silenceSeconds: TimeInterval = 2.0
let quietStartSeconds: TimeInterval = 10

func put(_ name: String, _ text: String) {
    try? text.write(to: session.appendingPathComponent(name), atomically: true, encoding: .utf8)
}

final class Listener {
    let engine = AVAudioEngine()
    let request = SFSpeechAudioBufferRecognitionRequest()
    var task: SFSpeechRecognitionTask?
    var text = ""
    var started = Date()
    var lastChange = Date()
    var heard = false
    var ending = false
    var finished = false
    var timer: Timer?

    func begin() {
        guard let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
              recognizer.isAvailable else {
            finish("unavailable")
            return
        }
        request.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        if #available(macOS 13, *) { request.addsPunctuation = true }

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.channelCount > 0 else {
            finish("no-microphone")
            return
        }
        let request = self.request
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            finish("no-microphone")
            return
        }

        started = Date()
        lastChange = Date()
        put("status", "listening")
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if let result = result {
                    let words = result.bestTranscription.formattedString
                    if words != self.text {
                        self.text = words
                        self.heard = true
                        self.lastChange = Date()
                        put("partial.txt", words)
                    }
                    if result.isFinal { self.finish(self.text.isEmpty ? "nothing" : "done") }
                } else if error != nil {
                    self.finish(self.text.isEmpty ? "nothing" : "done")
                }
            }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            self?.tick()
        }
    }

    func tick() {
        let now = Date()
        let stopAsked = FileManager.default.fileExists(atPath: session.appendingPathComponent("stop").path)
        let silent = heard && now.timeIntervalSince(lastChange) > silenceSeconds
        let quiet = !heard && now.timeIntervalSince(started) > quietStartSeconds
        if stopAsked || silent || quiet || now.timeIntervalSince(started) > maxSeconds { end() }
    }

    // Stop the microphone, then give the recognizer a moment to settle its last words.
    func end() {
        guard !ending else { return }
        ending = true
        timer?.invalidate()
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request.endAudio()
        put("status", "finishing")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            self.finish(self.text.isEmpty ? "nothing" : "done")
        }
    }

    func finish(_ status: String) {
        guard !finished else { return }
        finished = true
        put("final.txt", text)
        put("status", status)
        exit(0)
    }
}

let listener = Listener()

func startListening() {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized:
        listener.begin()
    case .notDetermined:
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            DispatchQueue.main.async {
                if granted { listener.begin() } else { listener.finish("denied-mic") }
            }
        }
    default:
        listener.finish("denied-mic")
    }
}

put("status", "starting")
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
DispatchQueue.main.async {
    SFSpeechRecognizer.requestAuthorization { status in
        DispatchQueue.main.async {
            if status == .authorized { startListening() } else { listener.finish("denied-speech") }
        }
    }
}
app.run()
