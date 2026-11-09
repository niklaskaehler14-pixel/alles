package de.sprachliste.ai

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class SpeechState(
    val listening: Boolean = false,
    val finalText: String = "",
    val partial: String = "",
    val level: Float = 0f,
    val error: String? = null,
) {
    val fullText: String get() = listOf(finalText, partial).filter { it.isNotBlank() }.joinToString(" ")
}

/**
 * Dauer-Diktat: Android beendet die Erkennung nach Sprechpausen. Wir starten sie
 * automatisch neu und hängen den Text an – so kann man auch 15 Minuten am Stück reden,
 * bis man auf "Fertig" tippt.
 */
class SpeechController(private val context: Context) {
    private var recognizer: SpeechRecognizer? = null
    private var keepGoing = false
    private val handler = Handler(Looper.getMainLooper())
    /** Aufeinanderfolgende technische Fehler ohne dass etwas erkannt wurde. */
    private var failures = 0
    private val _state = MutableStateFlow(SpeechState())
    val state: StateFlow<SpeechState> = _state.asStateFlow()

    fun isAvailable() = SpeechRecognizer.isRecognitionAvailable(context)

    fun start() {
        keepGoing = true
        failures = 0
        _state.value = SpeechState(listening = true)
        listen()
    }

    /** Beendet das Diktat und liefert den gesamten Text. */
    fun stop(): String {
        keepGoing = false
        handler.removeCallbacksAndMessages(null)
        recognizer?.stopListening()
        recognizer?.destroy(); recognizer = null
        val text = _state.value.fullText
        _state.value = _state.value.copy(listening = false, finalText = text, partial = "")
        return text
    }

    fun reset() { _state.value = SpeechState() }

    private fun listen() {
        recognizer?.destroy()
        val r = SpeechRecognizer.createSpeechRecognizer(context)
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() { failures = 0 }
            override fun onRmsChanged(rmsdB: Float) {
                _state.value = _state.value.copy(level = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f))
            }
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onError(error: Int) {
                if (!keepGoing) return
                // Stille ist kein Fehler: einfach weiter zuhören
                val silence = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                val fatal = error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS
                if (!silence) failures++
                if (fatal || failures > MAX_FAILURES) {
                    keepGoing = false
                    commitPartial()
                    _state.value = _state.value.copy(listening = false, error = describe(error))
                    return
                }
                // Verbindung zum Erkennungsdienst getrennt, Dienst beschäftigt o. Ä.:
                // kurz warten und mit frischer Verbindung weitermachen, der Text bleibt erhalten.
                commitPartial()
                restart(if (silence) 150L else 350L * failures)
            }
            override fun onResults(results: Bundle?) {
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                val s = _state.value
                _state.value = s.copy(
                    finalText = listOf(s.finalText, text.ifBlank { s.partial }).filter { it.isNotBlank() }.joinToString(" "),
                    partial = "",
                )
                failures = 0
                if (keepGoing) restart(150L)
            }
            override fun onPartialResults(partialResults: Bundle?) {
                val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                if (!text.isNullOrBlank()) { failures = 0; _state.value = _state.value.copy(partial = text) }
            }
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "de-DE")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 4000L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 4000L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 15000L)
        }
        runCatching { r.startListening(intent) }.onFailure { restart(500L) }
    }

    private fun restart(delayMs: Long) {
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({ if (keepGoing) listen() }, delayMs)
    }

    private fun commitPartial() {
        val s = _state.value
        if (s.partial.isNotBlank()) _state.value = s.copy(finalText = s.fullText, partial = "")
    }

    private fun describe(error: Int) = when (error) {
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Der Mikrofonzugriff fehlt."
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
            "Keine Internetverbindung für die Spracherkennung. Dein bisheriger Text bleibt erhalten."
        SpeechRecognizer.ERROR_AUDIO -> "Das Mikrofon wird gerade von einer anderen App verwendet."
        else -> "Die Spracherkennung ist gerade nicht erreichbar. Dein bisheriger Text bleibt erhalten – tippe auf „Fertig“ oder versuch es gleich noch einmal."
    }

    fun destroy() {
        keepGoing = false
        handler.removeCallbacksAndMessages(null)
        recognizer?.destroy(); recognizer = null
    }

    private companion object { const val MAX_FAILURES = 5 }
}
