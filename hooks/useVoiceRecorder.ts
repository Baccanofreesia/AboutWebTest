/**
 * useVoiceRecorder — 录音 Hook (MediaRecorder API)
 * 
 * 提供按住录音、松手停止的能力，返回 Blob 音频数据。
 * 同时提供录音时长和音量级别用于 UI 动画。
 */
import { useState, useRef, useCallback, useEffect } from 'react';

export interface VoiceRecordResult {
    blob: Blob;
    duration: number;      // seconds
    url: string;           // blob URL for playback
}

export function useVoiceRecorder() {
    const [isRecording, setIsRecording] = useState(false);
    const [isMonitoring, setIsMonitoring] = useState(false);
    const [duration, setDuration] = useState(0);
    const [volumeLevel, setVolumeLevel] = useState(0);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const startTimeRef = useRef(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animFrameRef = useRef<number>(0);
    const lastVolumeUpdateRef = useRef<number>(0);
    const resolveRef = useRef<((result: VoiceRecordResult | null) => void) | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
            streamRef.current?.getTracks().forEach(t => t.stop());
            audioCtxRef.current?.close();
        };
    }, []);

    const updateVolume = useCallback(() => {
        if (!analyserRef.current) return;
        const analyser = analyserRef.current;
        const freqData = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(freqData);
        let freqSum = 0;
        for (let i = 0; i < freqData.length; i++) {
            freqSum += freqData[i];
        }
        const avgFreq = freqSum / Math.max(1, freqData.length);

        const timeData = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(timeData);
        let squareSum = 0;
        for (let i = 0; i < timeData.length; i++) {
            const normalized = (timeData[i] - 128) / 128;
            squareSum += normalized * normalized;
        }
        const rms = Math.sqrt(squareSum / Math.max(1, timeData.length));

        // Mix RMS and frequency-domain energy for stabler microphone level.
        const vol = Math.min(1, Math.max(rms * 2.8, avgFreq / 92));

        const now = Date.now();
        if (now - (lastVolumeUpdateRef.current || 0) > 100) {
            setVolumeLevel(vol);
            lastVolumeUpdateRef.current = now;
        }
        animFrameRef.current = requestAnimationFrame(updateVolume);
    }, []);

    const ensureAnalyser = useCallback((stream: MediaStream) => {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
            audioCtxRef.current = new AudioContext();
        }
        const ctx = audioCtxRef.current;
        if (ctx?.state === 'suspended') {
            ctx.resume().catch(() => { });
        }
        if (!analyserRef.current) {
            const source = ctx!.createMediaStreamSource(stream);
            const analyser = ctx!.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            analyserRef.current = analyser;
        }
    }, []);

    const startMonitoring = useCallback(async (): Promise<boolean> => {
        try {
            if (isMonitoring) return true;
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
            });
            streamRef.current = stream;
            ensureAnalyser(stream);
            setIsMonitoring(true);
            updateVolume();
            return true;
        } catch {
            setIsMonitoring(false);
            return false;
        }
    }, [ensureAnalyser, isMonitoring, updateVolume]);

    const stopMonitoring = useCallback(() => {
        if (!isMonitoring) return;
        streamRef.current?.getTracks().forEach(t => t.stop());
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        audioCtxRef.current?.close();
        audioCtxRef.current = null;
        analyserRef.current = null;
        streamRef.current = null;
        setIsMonitoring(false);
        setVolumeLevel(0);
    }, [isMonitoring]);

    const startRecording = useCallback(async (): Promise<VoiceRecordResult | null> => {
        try {
            if (!streamRef.current) {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
                });
                streamRef.current = stream;
            }
            ensureAnalyser(streamRef.current);

            // Choose best supported format
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : MediaRecorder.isTypeSupported('audio/mp4')
                    ? 'audio/mp4'
                    : 'audio/webm';

            const recorder = new MediaRecorder(streamRef.current as MediaStream, { mimeType });
            mediaRecorderRef.current = recorder;
            chunksRef.current = [];

            return new Promise<VoiceRecordResult | null>((resolve) => {
                resolveRef.current = resolve;

                recorder.ondataavailable = (e) => {
                    if (e.data.size > 0) chunksRef.current.push(e.data);
                };

                recorder.onstop = () => {
                    const blob = new Blob(chunksRef.current, { type: mimeType });
                    const dur = Math.round((Date.now() - startTimeRef.current) / 1000);
                    const url = URL.createObjectURL(blob);

                    // Cleanup
                    streamRef.current?.getTracks().forEach(t => t.stop());
                    if (timerRef.current) clearInterval(timerRef.current);
                    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
                    audioCtxRef.current?.close();
                    audioCtxRef.current = null;
                    analyserRef.current = null;
                    streamRef.current = null;

                    setIsRecording(false);
                    setVolumeLevel(0);
                    setIsMonitoring(false);

                    if (dur < 1) {
                        // Too short, discard
                        URL.revokeObjectURL(url);
                        resolve(null);
                    } else {
                        resolve({ blob, duration: dur, url });
                    }
                };

                recorder.onerror = () => {
                    streamRef.current?.getTracks().forEach(t => t.stop());
                    if (timerRef.current) clearInterval(timerRef.current);
                    audioCtxRef.current?.close();
                    audioCtxRef.current = null;
                    analyserRef.current = null;
                    streamRef.current = null;
                    setIsRecording(false);
                    setIsMonitoring(false);
                    resolve(null);
                };

                // Start
                startTimeRef.current = Date.now();
                setDuration(0);
                setIsRecording(true);
                recorder.start(100); // collect data every 100ms

                // Timer for duration
                timerRef.current = setInterval(() => {
                    setDuration(Math.round((Date.now() - startTimeRef.current) / 1000));
                }, 200);

                // Volume animation
                updateVolume();
            });
        } catch (err) {
            console.error('[VoiceRecorder] Failed to start recording:', err);
            setIsRecording(false);
            return null;
        }
    }, [ensureAnalyser, updateVolume]);

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
    }, []);

    const cancelRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            // Clear chunks before stopping so onstop produces empty blob
            chunksRef.current = [];
            mediaRecorderRef.current.stop();
        }
        streamRef.current?.getTracks().forEach(t => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        audioCtxRef.current?.close();
        audioCtxRef.current = null;
        analyserRef.current = null;
        streamRef.current = null;
        setIsRecording(false);
        setIsMonitoring(false);
        setVolumeLevel(0);
        setDuration(0);
        resolveRef.current?.(null);
    }, []);

    return {
        isRecording,
        isMonitoring,
        duration,
        volumeLevel,
        startMonitoring,
        stopMonitoring,
        startRecording,
        stopRecording,
        cancelRecording,
    };
}
