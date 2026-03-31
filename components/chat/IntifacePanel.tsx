import React, { useState } from 'react';
import { useIntiface } from '../../context/IntifaceContext';
import Modal from '../os/Modal';

interface IntifacePanelProps {
  onClose: () => void;
}

const IntifacePanel: React.FC<IntifacePanelProps> = ({ onClose }) => {
  const {
    isEnabled, setIsEnabled,
    serverAddress, setServerAddress,
    isConnected, isConnecting, error,
    connect, disconnect, scan, stopAll,
    devices, vibrate, processMessage
  } = useIntiface();

  const [activeTab, setActiveTab] = useState<'control' | 'help'>('control');
  const [testIntensity, setTestIntensity] = useState(500);
  const [testingIndex, setTestingIndex] = useState<number | null>(null);
  const [testCommand, setTestCommand] = useState('');

  const handleToggleEnable = () => {
    setIsEnabled(!isEnabled);
  };

  const handleConnect = () => {
    if (isConnected) {
      disconnect();
    } else {
      connect(serverAddress);
    }
  };

  const handleTestVibrate = async (idx: number, intensity: number) => {
    setTestingIndex(idx);
    await vibrate(idx, intensity / 1000);
    setTimeout(() => setTestingIndex(null), 500);
  };

  const handleTestCommand = () => {
      if (testCommand.trim()) {
          processMessage(testCommand, true);
      }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Intiface Control"
    >
      <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button
            className={`flex-1 py-3 text-sm font-medium border-b-2 ${
                activeTab === 'control'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
            onClick={() => setActiveTab('control')}
          >
            设备控制
          </button>
          <button
            className={`flex-1 py-3 text-sm font-medium border-b-2 ${
                activeTab === 'help'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
            onClick={() => setActiveTab('help')}
          >
            AI 玩法说明
          </button>
      </div>

      <div className="p-4 space-y-6">
        
        {/* Enable Switch */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">启用设备控制</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">允许 AI 控制 Intiface/Buttplug 设备</p>
          </div>
          <button
            onClick={handleToggleEnable}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
              isEnabled ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                isEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {activeTab === 'control' && isEnabled && (
          <div className="space-y-4 border-t border-gray-200 dark:border-gray-700 pt-4">
            {/* Server Config */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                服务器地址 (WebSocket)
              </label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={serverAddress}
                  onChange={(e) => setServerAddress(e.target.value)}
                  disabled={isConnected}
                  className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white sm:text-sm p-2 border"
                  placeholder="ws://127.0.0.1:12345"
                />
                <button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className={`px-4 py-2 rounded-md text-sm font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                    isConnected
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-indigo-600 hover:bg-indigo-700'
                  } ${isConnecting ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isConnecting ? '连接中...' : isConnected ? '断开' : '连接'}
                </button>
              </div>
              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}
            </div>

            {/* Device Control */}
            {isConnected && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white">已连接设备 ({devices.length})</h4>
                  <div className="space-x-2">
                    <button
                      onClick={scan}
                      className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                    >
                      扫描设备
                    </button>
                    <button
                      onClick={stopAll}
                      className="text-xs px-2 py-1 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 rounded hover:bg-yellow-200 dark:hover:bg-yellow-800"
                    >
                      停止所有
                    </button>
                  </div>
                </div>

                {devices.length === 0 ? (
                  <div className="text-center py-4 text-gray-500 dark:text-gray-400 text-sm bg-gray-50 dark:bg-gray-800 rounded-md">
                    未发现设备，请确保 Intiface Central 已运行并点击扫描
                  </div>
                ) : (
                  <div className="space-y-2">
                    {devices.map((device, idx) => (
                      <div key={idx} className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-white truncate" title={device.name}>
                            {device.name}
                          </span>
                          <span className="text-xs text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900 px-1.5 py-0.5 rounded">
                            在线
                          </span>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          <span className="text-xs text-gray-500">测试震动:</span>
                          <input
                            type="range"
                            min="0"
                            max="1000"
                            value={testIntensity}
                            onChange={(e) => setTestIntensity(parseInt(e.target.value))}
                            onMouseUp={() => handleTestVibrate(idx, testIntensity)}
                            onTouchEnd={() => handleTestVibrate(idx, testIntensity)}
                            className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                          />
                          <button
                            onClick={() => handleTestVibrate(idx, testIntensity)}
                            disabled={testingIndex === idx}
                            className={`px-2 py-1 text-xs rounded transition-colors ${
                                testingIndex === idx 
                                ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200' 
                                : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900 dark:text-indigo-200'
                            }`}
                          >
                            {testingIndex === idx ? '发送中' : `${testIntensity}`}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'help' && isEnabled && (
            <div className="space-y-4 border-t border-gray-200 dark:border-gray-700 pt-4 text-sm text-gray-600 dark:text-gray-300">
                <p>要让 AI 控制您的设备，请在角色的设定或 Prompt 中加入以下说明：</p>
                <div className="bg-gray-100 dark:bg-gray-800 p-3 rounded-md font-mono text-xs overflow-x-auto select-all">
                    当你想控制玩具震动时，请在回复中包含以下指令（用户不可见）：<br/>
                    "VIBRATE": 500 <br/>
                    (数字代表强度 0-1000)
                </div>
                
                <div className="space-y-2">
                    <label className="block text-sm font-medium">指令测试</label>
                    <div className="flex space-x-2">
                        <input 
                            type="text" 
                            value={testCommand}
                            onChange={(e) => setTestCommand(e.target.value)}
                            placeholder='例如: 我现在开启震动 "VIBRATE": 500'
                            className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600 p-2 border"
                        />
                        <button 
                            onClick={handleTestCommand}
                            className="px-3 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                        >
                            发送测试
                        </button>
                    </div>
                    <p className="text-xs text-gray-500">
                        提示：指令会被自动隐藏，不会显示在聊天气泡中。
                    </p>
                </div>
            </div>
        )}
      </div>
    </Modal>
  );
};

export default IntifacePanel;
