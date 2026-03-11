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
    const [duration, setDuration] = useState(0);
    const [volumeLevel, setVolumeLevel] = useState(0);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const startTimeRef = useRef(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animFrameRef = useRef<number>(0);
    const resolveRef = useRef<((result: VoiceRecordResult | null) => void) | null>(null);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
            streamRef.current?.getTracks().forEach(t => t.stop());
        };
    }, []);

    const updateVolume = useCallback(() => {
        if (!analyserRef.current) return;
        const data = new Uint8Array(analyserRef.current.fftSize);
        analyserRef.current.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setVolumeLevel(Math.min(1, rms * 3)); // normalize to 0-1
        animFrameRef.current = requestAnimationFrame(updateVolume);
    }, []);

    const startRecording = useCallback(async (): Promise<VoiceRecordResult | null> => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000
                }
            });
            streamRef.current = stream;

            // Setup analyser for volume visualization
            const audioCtx = new AudioContext();
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            analyserRef.current = analyser;

            // Choose best supported format
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : MediaRecorder.isTypeSupported('audio/mp4')
                    ? 'audio/mp4'
                    : 'audio/webm';

            const recorder = new MediaRecorder(stream, { mimeType });
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
                    stream.getTracks().forEach(t => t.stop());
                    if (timerRef.current) clearInterval(timerRef.current);
                    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
                    audioCtx.close();

                    setIsRecording(false);
                    setVolumeLevel(0);

                    if (dur < 1) {
                        // Too short, discard
                        URL.revokeObjectURL(url);
                        resolve(null);
                    } else {
                        resolve({ blob, duration: dur, url });
                    }
                };

                recorder.onerror = () => {
                    stream.getTracks().forEach(t => t.stop());
                    if (timerRef.current) clearInterval(timerRef.current);
                    audioCtx.close();
                    setIsRecording(false);
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
    }, [updateVolume]);

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
        setIsRecording(false);
        setVolumeLevel(0);
        setDuration(0);
        resolveRef.current?.(null);
    }, []);

    return {
        isRecording,
        duration,
        volumeLevel,
        startRecording,
        stopRecording,
        cancelRecording,
    };
}
