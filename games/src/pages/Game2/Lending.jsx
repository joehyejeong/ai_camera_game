import { useState } from 'react'
import StartButton from '../../assets/game2/Start.png'

function Lending({ onStart, onBackToHome }) {
    const [serialStatus, setSerialStatus] = useState('연결 안됨')
    const [isConnecting, setIsConnecting] = useState(false)

    const handleConnectSerial = async () => {
        if (typeof navigator === 'undefined' || !navigator.serial) {
            alert('이 브라우저는 Web Serial API를 지원하지 않습니다.')
            return
        }

        if (window.serialPort && window.serialPort.readable) {
            setSerialStatus('이미 연결됨')
            return
        }

        setIsConnecting(true)
        setSerialStatus('연결 중...')

        try {
            const port = await navigator.serial.requestPort()
            await port.open({ baudRate: 9600 })

            window.serialPort = port
            setSerialStatus('연결됨')
        } catch (error) {
            if (error.name === 'NotFoundError') {
                setSerialStatus('연결 취소됨')
            } else {
                console.error('Serial connection failed:', error)
                setSerialStatus('연결 실패: ' + error.message)
            }
        } finally {
            setIsConnecting(false)
        }
    }

    return (
        <div
            style={{
                width: '100vw',
                height: '100vh',
                backgroundColor: '#000',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '20px'
            }}
        >
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '20px'
                }}
            >
                {/* 시리얼 연결 버튼 */}
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '10px'
                    }}
                >
                    <button
                        onClick={handleConnectSerial}
                        disabled={isConnecting}
                        style={{
                            padding: '12px 24px',
                            fontSize: '16px',
                            backgroundColor: isConnecting ? '#666' : '#4CAF50',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: isConnecting ? 'not-allowed' : 'pointer',
                            fontWeight: 'bold',
                            minWidth: '200px'
                        }}
                    >
                        {isConnecting ? '연결 중...' : '시리얼 연결'}
                    </button>
                    <div
                        style={{
                            color: '#fff',
                            fontSize: '14px',
                            textAlign: 'center'
                        }}
                    >
                        상태: {serialStatus}
                    </div>
                </div>

                {/* 시작 버튼 */}
                <div
                    onClick={onStart}
                    style={{
                        cursor: 'pointer'
                    }}
                >
                    <img
                        src={StartButton}
                        alt="Start"
                        style={{
                            imageRendering: 'pixelated',
                            cursor: 'pointer'
                        }}
                    />
                </div>

                {/* 홈 버튼 */}
                {onBackToHome && (
                    <button
                        onClick={async () => {
                            // 시리얼 포트 닫기
                            if (window.serialPort) {
                                try {
                                    // reader가 있으면 먼저 정리
                                    if (window.serialReader) {
                                        try {
                                            await window.serialReader.cancel()
                                            window.serialReader.releaseLock()
                                        } catch (e) {
                                            // Ignore
                                        }
                                        window.serialReader = null
                                    }
                                    // 포트 닫기
                                    if (window.serialPort.readable) {
                                        await window.serialPort.close()
                                    }
                                } catch (e) {
                                    console.warn('포트 닫기 실패:', e)
                                }
                                window.serialPort = null
                            }
                            onBackToHome()
                        }}
                        style={{
                            padding: '12px 24px',
                            fontSize: '16px',
                            backgroundColor: '#2196F3',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontWeight: 'bold',
                            minWidth: '200px'
                        }}
                    >
                        홈으로
                    </button>
                )}
            </div>
        </div>
    )
}

export default Lending

