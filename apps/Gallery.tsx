
import React, { useState, useEffect } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { GalleryImage, CharacterProfile } from '../types';

const Gallery: React.FC = () => {
    const { closeApp, characters, apiConfig, addToast } = useOS();
    const [view, setView] = useState<'albums' | 'grid' | 'detail'>('albums');
    const [activeCharId, setActiveCharId] = useState<string | null>(null);
    const [images, setImages] = useState<GalleryImage[]>([]);
    const [selectedImage, setSelectedImage] = useState<GalleryImage | null>(null);
    const [isReviewing, setIsReviewing] = useState(false);

    useEffect(() => {
        if (activeCharId) {
            DB.getGalleryImages(activeCharId).then(imgs => {
                // Sort by new
                setImages(imgs.sort((a, b) => b.timestamp - a.timestamp));
            });
        }
    }, [activeCharId]);

    const handleCharClick = (id: string) => {
        setActiveCharId(id);
        setView('grid');
    };

    const handleImageClick = (img: GalleryImage) => {
        setSelectedImage(img);
        setView('detail');
    };

    const handleBack = () => {
        if (view === 'detail') setView('grid');
        else if (view === 'grid') { setView('albums'); setActiveCharId(null); }
        else closeApp();
    };

    const handleReview = async () => {
        if (!selectedImage || !activeCharId || !apiConfig.apiKey) {
            addToast('缺少配置或图片信息', 'error');
            return;
        }

        const char = characters.find(c => c.id === activeCharId);
        if (!char) return;

        setIsReviewing(true);
        try {
            // 构建更稳健的 Prompt，强调角色扮演
            const systemContent = `You are ${char.name}. ${char.systemPrompt || 'You are a helpful assistant.'}
Task: The user sent you a photo. Comment on it briefly (1-3 sentences) based on your personality.
Style: Casual, conversational, strictly NO AI-assistant tone. React as if you received this on a chat app.`;

            // 构建符合 OpenAI Vision 标准的请求体
            // 注意：移除 detail: "auto" 以提高对各种 Gemini 代理的兼容性
            const payload = {
                model: apiConfig.model,
                messages: [
                    { role: 'system', content: systemContent },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: "Look at this photo I sent you." },
                            { 
                                type: 'image_url', 
                                image_url: { 
                                    url: selectedImage.url
                                } 
                            }
                        ]
                    }
                ],
                // 关键修复：增加 max_tokens，防止推理模型(Reasoning Models)在思考阶段耗尽Token导致content为空
                max_tokens: 3000, 
                temperature: 0.7,
                stream: false // 显式关闭流式传输以简化处理
            };

            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json', 
                    'Authorization': `Bearer ${apiConfig.apiKey}` 
                },
                body: JSON.stringify(payload)
            });

            // 增强的错误处理逻辑
            if (!response.ok) {
                let errorMsg = `HTTP Error ${response.status}`;
                try {
                    const errData = await response.json();
                    errorMsg = errData.error?.message || JSON.stringify(errData.error) || errorMsg;
                    if (errorMsg.includes('vision') || errorMsg.includes('image')) {
                        errorMsg = '当前模型可能不支持图片识别(Vision)，请切换模型。';
                    }
                } catch (e) {
                    const text = await response.text();
                    if(text) errorMsg = text.slice(0, 100);
                }
                throw new Error(errorMsg);
            }

            const data = await response.json();
            console.log("Gallery Review Response:", data); // Debug log

            const choice = data.choices?.[0];
            
            // 检查内容过滤器
            if (choice?.finish_reason === 'content_filter') {
                throw new Error('AI 拒绝回复 (图片可能包含敏感内容)');
            }

            // 尝试多种方式提取内容
            let reviewText = choice?.message?.content;
            
            // 兼容性Fallback: 
            // 1. 如果 content 为空但有 reasoning_content (推理模型常见情况)，优先使用推理内容
            if (!reviewText && choice?.message?.reasoning_content) {
                reviewText = choice.message.reasoning_content;
            }
            // 2. 传统 fallback
            if (!reviewText && choice?.text) reviewText = choice.text;
            if (!reviewText && choice?.delta?.content) reviewText = choice.delta.content;

            if (!reviewText) {
                // 如果内容仍为空，打印详细结构以便调试
                const debugStr = JSON.stringify(choice || data);
                console.warn('AI Empty Response Structure:', data);
                throw new Error(`AI 返回内容为空. Raw: ${debugStr.substring(0, 100)}...`);
            }

            // 更新数据库
            await DB.updateGalleryImageReview(selectedImage.id, reviewText);
            
            // 更新本地状态
            const updatedImage = { ...selectedImage, review: reviewText, reviewTimestamp: Date.now() };
            setSelectedImage(updatedImage);
            setImages(prev => prev.map(img => img.id === selectedImage.id ? updatedImage : img));
            
            addToast('点评生成成功', 'success');
            
        } catch (e: any) {
            console.error('Review Error:', e);
            addToast(`点评失败: ${e.message}`, 'error');
        } finally {
            setIsReviewing(false);
        }
    };

    // --- Sub-Components ---

    const renderAlbums = () => (
        <div className="grid grid-cols-2 gap-4 p-4 animate-fade-in">
            {characters.map(char => (
                <button key={char.id} onClick={() => handleCharClick(char.id)} className="flex flex-col gap-2 group active:scale-95 transition-transform">
                    <div className="aspect-square bg-slate-200 rounded-2xl shadow-sm overflow-hidden relative border border-white">
                        {/* Simulate Folder look */}
                         <div className="absolute top-2 left-2 w-full h-full bg-white opacity-50 rounded-xl"></div>
                         <img src={char.avatar} className="absolute inset-0 w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                         <div className="absolute inset-0 bg-black/10 group-hover:bg-transparent transition-colors"></div>
                    </div>
                    <span className="text-sm font-medium text-slate-700 text-center">{char.name}</span>
                </button>
            ))}
            {characters.length === 0 && <div className="col-span-2 text-center text-slate-400 py-10 text-xs">暂无角色相册</div>}
        </div>
    );

    const renderGrid = () => (
        <div className="flex-1 overflow-y-auto p-1 animate-fade-in">
            {images.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10 opacity-50"><path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg>
                    <span className="text-xs">暂无图片</span>
                </div>
            ) : (
                <div className="grid grid-cols-3 gap-0.5">
                    {images.map(img => (
                        <div key={img.id} onClick={() => handleImageClick(img)} className="aspect-square bg-slate-100 relative cursor-pointer overflow-hidden">
                            <img src={img.url} className="w-full h-full object-cover hover:scale-105 transition-transform duration-300" loading="lazy" />
                            {img.review && <div className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full ring-1 ring-white"></div>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    const renderDetail = () => selectedImage && (
        <div className="flex flex-col h-full bg-black relative animate-fade-in">
            {/* 1. Header (High contrast back button) */}
            <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-start z-50 pointer-events-none">
                <button onClick={() => setView('grid')} className="text-white bg-black/40 backdrop-blur-md p-2 rounded-full pointer-events-auto active:scale-95 transition-transform hover:bg-black/60 border border-white/10">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                </button>
            </div>

            {/* 2. Main Image Area (Flex layout ensures image is contained and doesn't overlap text) */}
            <div className="flex-1 min-h-0 w-full flex items-center justify-center bg-black relative overflow-hidden">
                <img 
                    src={selectedImage.url} 
                    className="max-w-full max-h-full object-contain" 
                    alt="Detail"
                />
            </div>

            {/* 3. Review Section (Static Flow - Bottom of Flex Column) */}
            <div className="shrink-0 w-full bg-[#161616] border-t border-white/10 z-40 pb-safe">
                {selectedImage.review ? (
                    <div className="p-5 animate-slide-up">
                        <div className="flex items-start gap-3 mb-3">
                            <img src={characters.find(c => c.id === activeCharId)?.avatar} className="w-9 h-9 rounded-full border border-white/20 object-cover shadow-sm" />
                            <div className="flex-1">
                                <div className="text-xs font-bold text-white/50 mb-1.5 uppercase tracking-wide">{characters.find(c => c.id === activeCharId)?.name} 的点评</div>
                                <p className="text-[15px] text-white/90 leading-relaxed font-light select-text">"{selectedImage.review}"</p>
                            </div>
                        </div>
                        <div className="flex justify-end border-t border-white/5 pt-2 mt-2">
                             <button onClick={handleReview} disabled={isReviewing} className="text-[10px] text-white/40 hover:text-primary transition-colors flex items-center gap-1 px-2 py-1">
                                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                                 {isReviewing ? 'Thinking...' : '重新生成'}
                             </button>
                        </div>
                    </div>
                ) : (
                    <div className="p-6 flex justify-center items-center">
                        <button 
                            onClick={handleReview} 
                            disabled={isReviewing}
                            className="bg-white text-black px-6 py-3 rounded-full text-sm font-bold shadow-[0_0_20px_rgba(255,255,255,0.15)] active:scale-95 transition-transform flex items-center gap-2 hover:bg-slate-200"
                        >
                            {isReviewing ? (
                                <><div className="w-4 h-4 border-2 border-slate-300 border-t-black rounded-full animate-spin"></div> 正在思考...</>
                            ) : (
                                <><span className="text-lg">✨</span> 让 TA 点评照片</>
                            )}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="h-full w-full bg-slate-50 flex flex-col font-light relative">
            {/* Header - Only show if not in detail view to mimic iOS Photos app behavior */}
            {view !== 'detail' && (
                <div className="h-20 bg-white/70 backdrop-blur-md flex items-end pb-3 px-4 border-b border-white/40 shrink-0 z-10 sticky top-0">
                    <div className="flex items-center gap-2 w-full">
                         <button onClick={handleBack} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600">
                                {view === 'albums' ? (
                                     <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                                ) : (
                                     <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                                )}
                            </svg>
                        </button>
                        <h1 className="text-xl font-medium text-slate-700 tracking-wide">
                            {view === 'albums' ? '相册' : characters.find(c => c.id === activeCharId)?.name || '相册'}
                        </h1>
                    </div>
                </div>
            )}

            {view === 'albums' && renderAlbums()}
            {view === 'grid' && renderGrid()}
            {view === 'detail' && renderDetail()}
        </div>
    );
};

export default Gallery;
