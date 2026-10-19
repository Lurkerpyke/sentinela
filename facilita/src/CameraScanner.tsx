import { useEffect, useRef, useState } from 'react'
import { Flashlight, FlashlightOff, RefreshCw, ScanLine } from 'lucide-react'
import type { IScannerControls } from '@zxing/browser'
import './CameraScanner.css'

type DetectedCode = { rawValue: string }
type BarcodeDetectorInstance = { detect: (source: HTMLVideoElement) => Promise<DetectedCode[]> }
type BarcodeDetectorConstructor = {
    new(options: { formats: string[] }): BarcodeDetectorInstance
    getSupportedFormats: () => Promise<string[]>
}

declare global {
    interface Window {
        BarcodeDetector?: BarcodeDetectorConstructor
    }
}

interface CameraScannerProps {
    onDetected: (value: string) => Promise<boolean>
}

function cameraErrorMessage(error: unknown): string {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
        return 'A câmera foi bloqueada. Libere a permissão nas configurações do navegador ou digite o código.'
    }
    if (error instanceof DOMException && error.name === 'NotFoundError') {
        return 'Não encontramos uma câmera neste aparelho. Digite o código de barras.'
    }
    if (!window.isSecureContext) {
        return 'A câmera precisa de uma conexão segura (HTTPS). Use localhost durante o desenvolvimento.'
    }
    return 'Não foi possível abrir a câmera. Confira a permissão ou digite o código.'
}

function getTorchCapability(track: MediaStreamTrack): boolean {
    try {
        const capabilities = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean }
        return capabilities.torch === true
    } catch {
        return false
    }
}

export function CameraScanner({ onDetected }: CameraScannerProps) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const onDetectedRef = useRef(onDetected)
    const [message, setMessage] = useState('')
    const [scannerError, setScannerError] = useState('')
    const [loading, setLoading] = useState(true)
    const [hasTorch, setHasTorch] = useState(false)
    const [torchOn, setTorchOn] = useState(false)
    const [retryKey, setRetryKey] = useState(0)
    const torchControlRef = useRef<((enabled: boolean) => Promise<void>) | null>(null)

    useEffect(() => {
        onDetectedRef.current = onDetected
    }, [onDetected])

    useEffect(() => {
        let cancelled = false
        let accepted = false
        let nativeStream: MediaStream | null = null
        let zxingControls: IScannerControls | null = null
        let timeoutId: ReturnType<typeof setTimeout> | undefined
        let lastCode = ''
        let lastCodeAt = 0

        const stopCamera = () => {
            cancelled = true
            if (timeoutId) clearTimeout(timeoutId)
            zxingControls?.stop()
            nativeStream?.getTracks().forEach((track) => track.stop())
            const video = videoRef.current
            if (video) video.srcObject = null
        }

        const processCode = async (rawValue: string) => {
            if (accepted || cancelled) return
            const now = Date.now()
            if (rawValue === lastCode && now - lastCodeAt < 2500) return
            lastCode = rawValue
            lastCodeAt = now
            accepted = await onDetectedRef.current(rawValue)
            if (!accepted && !cancelled) {
                setMessage('Código não reconhecido como EAN válido. Tente novamente ou digite manualmente.')
            }
        }

        async function startScanner() {
            setLoading(true)
            setScannerError('')
            setMessage('')
            setHasTorch(false)
            setTorchOn(false)
            torchControlRef.current = null

            try {
                if (!navigator.mediaDevices?.getUserMedia) {
                    throw new Error('Camera API unavailable')
                }

                const detectorConstructor = window.BarcodeDetector
                const supportedFormats = detectorConstructor
                    ? await detectorConstructor.getSupportedFormats().catch(() => [])
                    : []
                const requiredFormats = ['ean_13', 'ean_8', 'upc_a']
                const canUseNative = Boolean(
                    detectorConstructor && requiredFormats.every((format) => supportedFormats.includes(format)),
                )

                if (canUseNative && detectorConstructor) {
                    nativeStream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
                        audio: false,
                    })
                    if (cancelled) {
                        nativeStream.getTracks().forEach((track) => track.stop())
                        return
                    }
                    const video = videoRef.current
                    if (!video) return
                    video.srcObject = nativeStream
                    await video.play()
                    const track = nativeStream.getVideoTracks()[0]
                    if (track) {
                        setHasTorch(getTorchCapability(track))
                        torchControlRef.current = async (enabled) => {
                            await track.applyConstraints({ advanced: [{ torch: enabled } as MediaTrackConstraintSet] })
                        }
                    }

                    const detector = new detectorConstructor({ formats: requiredFormats })
                    const detectFrame = async () => {
                        if (cancelled || accepted || !videoRef.current) return
                        try {
                            const results = await detector.detect(videoRef.current)
                            if (results[0]) await processCode(results[0].rawValue)
                        } catch {
                            setMessage('A leitura falhou nesta imagem. Mantenha o código centralizado.')
                        }
                        if (!cancelled && !accepted) timeoutId = setTimeout(detectFrame, 180)
                    }
                    void detectFrame()
                } else {
                    const [{ BrowserMultiFormatReader }, { BarcodeFormat }] = await Promise.all([
                        import('@zxing/browser'),
                        import('@zxing/library'),
                    ])
                    if (cancelled) return
                    const reader = new BrowserMultiFormatReader()
                    reader.possibleFormats = [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A]
                    const controls = await reader.decodeFromConstraints(
                        { video: { facingMode: { ideal: 'environment' } }, audio: false },
                        videoRef.current ?? undefined,
                        (result) => {
                            if (result) void processCode(result.getText())
                        },
                    )
                    zxingControls = controls
                    if (cancelled) {
                        controls.stop()
                        return
                    }
                    try {
                        const capabilities = controls.streamVideoCapabilitiesGet?.((track) => [track]) as (MediaTrackCapabilities & { torch?: boolean }) | undefined
                        setHasTorch(capabilities?.torch === true && controls.switchTorch !== undefined)
                    } catch {
                        setHasTorch(false)
                    }
                    torchControlRef.current = controls.switchTorch ?? null
                }
                if (!cancelled) setLoading(false)
            } catch (error) {
                if (!cancelled) {
                    setScannerError(cameraErrorMessage(error))
                    setLoading(false)
                }
            }
        }

        void startScanner()
        return stopCamera
    }, [retryKey])

    async function toggleTorch() {
        try {
            const nextState = !torchOn
            await torchControlRef.current?.(nextState)
            setTorchOn(nextState)
        } catch {
            setMessage('A lanterna não pôde ser ativada neste aparelho.')
            setHasTorch(false)
        }
    }

    return (
        <div className="camera-panel">
            <video ref={videoRef} className="camera-video" autoPlay muted playsInline aria-label="Imagem da câmera para leitura do código" />
            <div className="camera-frame" aria-hidden="true">
                <span className="camera-corner top-left" />
                <span className="camera-corner top-right" />
                <span className="camera-corner bottom-left" />
                <span className="camera-corner bottom-right" />
                <ScanLine size={34} />
            </div>
            {loading && <div className="camera-message">Abrindo câmera…</div>}
            {scannerError && <div className="camera-error"><p>{scannerError}</p><button type="button" onClick={() => setRetryKey((key) => key + 1)}><RefreshCw size={16} /> Tentar novamente</button></div>}
            {!loading && !scannerError && <div className="camera-hint">Centralize o código dentro da moldura</div>}
            {message && <div className="camera-toast" role="status">{message}</div>}
            {hasTorch && <button className="torch-button" type="button" onClick={toggleTorch} aria-label={torchOn ? 'Desligar lanterna' : 'Ligar lanterna'}>{torchOn ? <FlashlightOff size={18} /> : <Flashlight size={18} />}</button>}
            {scannerError && <div className="camera-fallback-icon"><ScanLine size={27} /></div>}
        </div>
    )
}
