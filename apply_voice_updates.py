from pathlib import Path

path = Path('src/pages/DiaryPage.jsx')
text = path.read_text(encoding='utf-8-sig')

def block_to_crlf(block: str) -> str:
    return block.strip('\n').replace('\n', '\r\n') + '\r\n'

old_map = block_to_crlf("""
  function mapSpeechEmotion(resp) {
    const probs = resp?.probs && typeof resp.probs === 'object' ? resp.probs : {}
    let label = resp?.pred || 'neutral'
    let score = typeof probs[label] === 'number' ? probs[label] : undefined
    const entries = Object.entries(probs)
    if (score == null && entries.length) {
      const [bestLabel, bestScore] = entries.reduce((acc, cur) => (cur[1] > acc[1] ? cur : acc))
      label = bestLabel
      score = bestScore
    }
    if (typeof score !== 'number') score = 0.5
    score = Math.max(0, Math.min(1, score))
    return {
      label,
      score,
      confidence: score,
      probs,
      source: 'speech'
    }
  }
""")

new_map = block_to_crlf("""
  function mapSpeechEmotion(resp) {
    const probs = resp?.probs && typeof resp.probs === 'object' ? resp.probs : {}
    let rawLabel = resp?.pred || 'neutral'
    let score = typeof probs[rawLabel] === 'number' ? probs[rawLabel] : undefined
    const entries = Object.entries(probs)
    if (score == null && entries.length) {
      const [bestLabel, bestScore] = entries.reduce((acc, cur) => (cur[1] > acc[1] ? cur : acc))
      rawLabel = bestLabel
      score = bestScore
    }
    if (typeof score !== 'number') score = 0.5
    score = Math.max(0, Math.min(1, score))
    const positiveLabels = new Set(['happy', 'joy', 'calm', 'positive', 'excited', 'content'])
    const negativeLabels = new Set(['angry', 'sad', 'fear', 'disgust', 'negative', 'frustrated', 'depressed'])
    let label = 'neutral'
    if (positiveLabels.has(rawLabel)) label = 'positive'
    else if (negativeLabels.has(rawLabel)) label = 'negative'
    return {
      label,
      score,
      confidence: score,
      probs,
      rawLabel,
      source: 'speech'
    }
  }
""")

old_attach = block_to_crlf("""
  function attachHandlers(r) {
    r.onresult = (e) => {
      try {
        let interimText = ''
        let newFinal = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i]
          if (res.isFinal) newFinal += res[0].transcript
          else interimText += res[0].transcript
        }
        newFinal = String(newFinal).replace(/\r?\n/g, '\n')
        interimText = String(interimText).replace(/\r?\n/g, '\n')

        if (newFinal) {
          const now = Date.now()
          const endsWithPunctuation = /[,，。？！；：]$/.test(finalRef.current) || finalRef.current.endsWith('\n')
          const needComma = finalRef.current && !endsWithPunctuation && (now - (lastAppendAtRef.current || 0) >= 1200)
          if (needComma) finalRef.current += ','
          lastAppendAtRef.current = now
        }

        if (newFinal) finalRef.current += newFinal
        const display = `${baseRef.current}${finalRef.current}${interimText}`
        if (setContent) setContent(display)
        setInterim(interimText)
      } catch (error) {
        console.error('[voice] onresult error', error)
      }
    }
    r.onerror = (e) => {
      const code = e?.error || ''
      if (code !== 'aborted' && code !== 'no-speech') setErr(code || 'speech error')
      stopRecorder()
      setListening(false)
      setInterim('')
    }
    r.onend = () => {
      stopRecorder()
      setListening(false)
      if (setContent) setContent(`${baseRef.current}${finalRef.current}`)
      setInterim('')
      setRecog(null)
    }
  }
""")

new_attach = block_to_crlf("""
  function attachHandlers(r, sessionId) {
    r.onstart = () => {
      setErr('')
    }
    r.onresult = (e) => {
      try {
        let interimText = ''
        let newFinal = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i]
          if (res.isFinal) newFinal += res[0].transcript
          else interimText += res[0].transcript
        }
        newFinal = String(newFinal).replace(/\r?\n/g, '\n')
        interimText = String(interimText).replace(/\r?\n/g, '\n')
        if (newFinal) {
          const now = Date.now()
          const endsWithPunctuation = /[，。？！；：]$/.test(finalRef.current) || finalRef.current.endsWith('\n')
          const needComma = finalRef.current && !endsWithPunctuation && (now - (lastAppendAtRef.current || 0) >= 1200)
          if (needComma) finalRef.current += '，'
          lastAppendAtRef.current = now
        }
        if (newFinal) finalRef.current += newFinal
        const display = `${baseRef.current}${finalRef.current}${interimText}`
        if (setContent) setContent(display)
        setInterim(interimText)
      } catch (error) {
        console.error('[voice] onresult error', error)
      }
    }
    r.onerror = (e) => {
      const code = e?.error || ''
      if (code !== 'aborted' && code !== 'no-speech') {
        setErr(code || 'speech error')
        console.warn('[voice] recognition error', code, e)
      }
    }
    r.onaudioend = () => {
      console.info('[voice] audio stream ended')
    }
    r.onend = () => {
      if (sessionRef.current === sessionId && mediaRecorderRef.current && streamRef.current) {
        try {
          r.start()
          return
        } catch (restartErr) {
          setTimeout(() => {
            if (sessionRef.current === sessionId && mediaRecorderRef.current && streamRef.current) {
              try { r.start() } catch (finalErr) { console.warn('[voice] restart failed', finalErr) }
            }
          }, 200)
          return
        }
      }
      stopRecorder()
      setListening(false)
      if (setContent) setContent(`${baseRef.current}${finalRef.current}`)
      setInterim('')
      setRecog(null)
    }
  }
""")

old_start = block_to_crlf("""
  async function start() {
    setErr('')
    if (listening || recording) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      setSupported(false)
      setErr('瀏覽器不支援語音輸入')
      return
    }
    if (!(navigator?.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      setErr('瀏覽器不支援錄音')
      return
    }

    onSpeechEmotion?.(null)
    clearAudio()

    const sessionId = sessionRef.current + 1
    sessionRef.current = sessionId

    baseRef.current = getContent ? (getContent() || '') : ''
    if (baseRef.current && !(baseRef.current.endsWith('\n') || baseRef.current.endsWith(' '))) baseRef.current += ' '
    finalRef.current = ''
    setInterim('')
    lastAppendAtRef.current = Date.now()

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      console.error('[speech] getUserMedia failed', err)
      setErr(err?.message || '無法開始錄音')
      onSpeechBusy?.(false)
      return
    }

    if (sessionRef.current !== sessionId) {
      try {
        recognition.stop()
        recognition.abort()
      } catch {}
      stream.getTracks().forEach(track => track.stop())
      return
    }

    try {
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (evt) => {
        if (evt.data && evt.data.size > 0) chunksRef.current.push(evt.data)
      }
      recorder.onstop = () => {
        mediaRecorderRef.current = null
        setRecording(false)
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop())
          streamRef.current = null
        }
        const mime = (recorder.mimeType && recorder.mimeType.startsWith('audio/')) ? recorder.mimeType : 'audio/webm;codecs=opus'
        const blob = new Blob(chunksRef.current, { type: mime })
        console.log('[speech] recorder stopped', { mimeType: recorder.mimeType, usedMime: mime, size: blob.size })
        chunksRef.current = []
        handleBlob(blob, mime)
      }
      mediaRecorderRef.current = recorder
      streamRef.current = stream
      try {
        recorder.start(500)
      } catch (err) {
        recorder.start()
      }
      setRecording(true)
      onSpeechBusy?.(true)
    } catch (err) {
      console.error('[speech] recorder start failed', err)
      setErr(err?.message || '無法開始錄音')
      if (stream) {
        stream.getTracks().forEach(track => track.stop())
      }
      onSpeechBusy?.(false)
      return
    }

    const r = new SR()
    r.lang = 'zh-TW'
    r.interimResults = true
    r.continuous = true
    attachHandlers(r)
    baseRef.current = getContent ? (getContent() || '') : ''
    if (baseRef.current && !(baseRef.current.endsWith('\n') || baseRef.current.endsWith(' '))) baseRef.current += ' '
    finalRef.current = ''
    setInterim('')
    lastAppendAtRef.current = Date.now()
    try {
      r.start()
      setRecog(r)
      setListening(true)
    } catch (err) {
      console.error('[speech] recognition start failed', err)
      setErr(err?.message || '語音辨識啟動失敗')
      stopRecorder()
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
      onSpeechBusy?.(false)
    }
  }
""")

new_start = block_to_crlf("""
  async function start() {
    setErr('')
    if (listening || recording) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      setSupported(false)
      setErr('瀏覽器不支援語音輸入')
      return
    }
    if (!(navigator?.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      setErr('瀏覽器不支援錄音')
      return
    }
    onSpeechEmotion?.(null)
    clearAudio()
    const sessionId = sessionRef.current + 1
    sessionRef.current = sessionId
    baseRef.current = getContent ? (getContent() || '') : ''
    if (baseRef.current && !(baseRef.current.endsWith('\n') || baseRef.current.endsWith(' '))) baseRef.current += ' '
    finalRef.current = ''
    setInterim('')
    lastAppendAtRef.current = Date.now()
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (err) {
      console.error('[speech] getUserMedia failed', err)
      setErr(err?.message || '無法開始錄音（麥克風權限或裝置問題）')
      onSpeechBusy?.(false)
      return
    }
    if (sessionRef.current !== sessionId) {
      stream.getTracks().forEach(track => track.stop())
      return
    }
    let recorder
    try {
      recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (evt) => {
        if (evt.data && evt.data.size > 0) chunksRef.current.push(evt.data)
      }
      recorder.onstop = () => {
        mediaRecorderRef.current = null
        setRecording(false)
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop())
          streamRef.current = null
        }
        const mime = (recorder.mimeType && recorder.mimeType.startsWith('audio/')) ? recorder.mimeType : 'audio/webm;codecs=opus'
        const blob = new Blob(chunksRef.current, { type: mime })
        console.log('[speech] recorder stopped', { mimeType: recorder.mimeType, usedMime: mime, size: blob.size })
        chunksRef.current = []
        handleBlob(blob, mime)
      }
    } catch (err) {
      console.error('[speech] recorder init failed', err)
      setErr(err?.message || '無法開始錄音')
      stream.getTracks().forEach(track => track.stop())
      onSpeechBusy?.(false)
      return
    }
    mediaRecorderRef.current = recorder
    streamRef.current = stream
    try {
      recorder.start(500)
    } catch (err) {
      let fallbackErr = err
      try {
        recorder.start()
        fallbackErr = null
      } catch (err2) {
        fallbackErr = err2
      }
      if (fallbackErr) {
        console.error('[speech] recorder start failed', fallbackErr)
        setErr(fallbackErr?.message || '無法開始錄音')
        stream.getTracks().forEach(track => track.stop())
        mediaRecorderRef.current = null
        streamRef.current = null
        onSpeechBusy?.(false)
        return
      }
    }
    setRecording(true)
    onSpeechBusy?.(true)
    if (sessionRef.current !== sessionId) {
      try { recorder.stop() } catch {}
      return
    }
    const recognition = new SR()
    recognition.lang = 'zh-TW'
    recognition.interimResults = true
    recognition.continuous = true
    attachHandlers(recognition, sessionId)
    try {
      recognition.start()
      setRecog(recognition)
      setListening(true)
    } catch (err) {
      console.error('[speech] recognition start failed', err)
      setErr(err?.message || '語音辨識啟動失敗')
      setListening(false)
      setRecog(null)
      try { recorder.stop() } catch {}
      stream.getTracks().forEach(track => track.stop())
      mediaRecorderRef.current = null
      streamRef.current = null
      setRecording(false)
      onSpeechBusy?.(false)
      return
    }
  }
""")

for old, new in [(old_map, new_map), (old_attach, new_attach), (old_start, new_start)]:
    if old not in text:
        raise SystemExit('Target block not found')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8-sig')
