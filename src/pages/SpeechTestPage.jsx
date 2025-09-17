import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { inferSpeechEmotion } from '../lib/speech'
import '../App.css'

export default function SpeechTestPage() {
  const [file, setFile] = useState(null)
  const [audioUrl, setAudioUrl] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [supported, setSupported] = useState(false)
  const [checkedSupport, setCheckedSupport] = useState(false)

  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])

  useEffect(() => {
    if (typeof window !== 'undefined' && navigator?.mediaDevices && window.MediaRecorder) {
      setSupported(true)
    }
    setCheckedSupport(true)
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!file) {
      setAudioUrl('')
      return
    }
    const url = URL.createObjectURL(file)
    setAudioUrl(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [file])

  async function startRecording() {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }
      recorder.onstop = () => {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop())
          streamRef.current = null
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const recordedFile = new File([blob], `recording-${Date.now()}.webm`, { type: blob.type })
        setFile(recordedFile)
        setRecording(false)
      }
      mediaRecorderRef.current = recorder
      streamRef.current = stream
      recorder.start()
      setRecording(true)
      setResult(null)
    } catch (err) {
      setError(err?.message || 'Failed to start recording')
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current
    if (!recorder) return
    if (recorder.state !== 'inactive') {
      recorder.stop()
    }
  }

  function onFileChange(event) {
    const f = event.target.files && event.target.files[0]
    if (f) {
      setFile(f)
      setResult(null)
      setError('')
    }
  }

  async function onAnalyze() {
    if (!file) {
      setError('Please record or select an audio file first')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await inferSpeechEmotion(file)
      setResult(res)
    } catch (err) {
      setResult(null)
      setError(err?.message || 'Speech inference failed')
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setFile(null)
    setResult(null)
    setAudioUrl('')
    setError('')
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    setRecording(false)
  }

  return (
    <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ marginBottom: 12 }}>Speech Emotion Test</h1>
        <Link to="/" style={{ fontSize: 14 }}>Back to journal</Link>
      </div>

      <p style={{ color: '#555', lineHeight: 1.6 }}>
        Upload a short audio clip (wav, m4a, mp3, webm...) or record with your microphone, then run it through the speech emotion service.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontWeight: 600 }}>Audio file</span>
          <input type="file" accept="audio/*" onChange={onFileChange} />
        </label>

        {supported && (
          <div style={{ display: 'flex', gap: 8 }}>
            {!recording ? (
              <button onClick={startRecording} className="btn btn-secondary">
                Start recording
              </button>
            ) : (
              <button onClick={stopRecording} className="btn btn-danger">
                Stop recording
              </button>
            )}
          </div>
        )}


        {!supported && checkedSupport && (
          <div style={{ fontSize: 13, color: '#666' }}>
            Microphone recording is not available in this browser. Upload an audio file instead.
          </div>
        )}

        <button onClick={reset} className="btn btn-outline" style={{ width: 160 }} disabled={!file && !recording}>
          Clear selection
        </button>

        {audioUrl && (
          <audio controls src={audioUrl} style={{ width: '100%' }} />
        )}

        <button onClick={onAnalyze} disabled={loading || recording} className="btn btn-primary" style={{ width: 180 }}>
          {loading ? 'Analyzing...' : 'Analyze audio'}
        </button>
      </div>

      {error && (
        <div style={{ color: 'crimson', marginTop: 12 }}>{error}</div>
      )}

      {result && (
        <div style={{ marginTop: 16, lineHeight: 1.6 }}>
          <div><strong>Prediction:</strong> {result.pred}</div>
          <div style={{ marginTop: 8 }}>
            <strong>Probabilities</strong>
            <ul style={{ paddingLeft: 20, marginTop: 6 }}>
              {Object.entries(result.probs || {}).map(([label, value]) => (
                <li key={label}>
                  {label}: {(value * 100).toFixed(2)}%
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
