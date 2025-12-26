// 시리얼 통신 프로토콜 상수
export const HEXGL_MESSAGE_HEAD_CODE = 0xFD
export const HEXGL_MESSAGE_END_CODE = 0xED

export const HexglMessageCommand = {
    KEYPOINT_BOX_DETECTION: 0,
    CLASSIFICATION: 1,
    DETECTION: 2
}

const HexglReceiveState = {
    WAIT_START: 0,
    HEAD: 1,
    DATA: 2,
    CRC: 3,
    END: 4
}

// 시리얼 통신 프로토콜 클래스
export class HexglAiCamProtocol {
    constructor() {
        this.state = HexglReceiveState.WAIT_START
        this.currentMessage = null
        this.receiveBuffer = []
    }

    feedByte(byte) {
        switch (this.state) {
            case HexglReceiveState.WAIT_START:
                if (byte === HEXGL_MESSAGE_HEAD_CODE) {
                    this.currentMessage = {
                        head: { head: byte, cmd: 0, length: 0 },
                        data: [],
                        crc: 0,
                        end: 0
                    }
                    this.receiveBuffer = []
                    this.state = HexglReceiveState.HEAD
                }
                break

            case HexglReceiveState.HEAD:
                this.receiveBuffer.push(byte)
                if (this.receiveBuffer.length === 3) {
                    this.currentMessage.head.cmd = this.receiveBuffer[0]
                    this.currentMessage.head.length = this.receiveBuffer[1] | (this.receiveBuffer[2] << 8)
                    this.receiveBuffer = []
                    this.state = HexglReceiveState.DATA
                }
                break

            case HexglReceiveState.DATA:
                this.receiveBuffer.push(byte)
                if (this.receiveBuffer.length === this.currentMessage.head.length) {
                    this.currentMessage.data = this.receiveBuffer.slice(0)
                    this.receiveBuffer = []
                    this.state = HexglReceiveState.CRC
                }
                break

            case HexglReceiveState.CRC:
                this.receiveBuffer.push(byte)
                if (this.receiveBuffer.length === 4) {
                    this.currentMessage.crc = this.receiveBuffer[0] |
                        (this.receiveBuffer[1] << 8) |
                        (this.receiveBuffer[2] << 16) |
                        (this.receiveBuffer[3] << 24)
                    this.receiveBuffer = []
                    this.state = HexglReceiveState.END
                }
                break

            case HexglReceiveState.END:
                if (byte === HEXGL_MESSAGE_END_CODE) {
                    this.state = HexglReceiveState.WAIT_START
                    this.currentMessage.end = byte
                    return this.currentMessage
                }
                break
        }

        return null
    }

    reset() {
        this.state = HexglReceiveState.WAIT_START
        this.currentMessage = null
        this.receiveBuffer = []
    }
}

// 시리얼 연결 요청
export const requestSerialConnection = async () => {
    if (typeof navigator === 'undefined' || !navigator.serial) {
        throw new Error('이 브라우저는 Web Serial API를 지원하지 않습니다.')
    }

    const port = await navigator.serial.requestPort()
    await port.open({ baudRate: 9600 })

    window.serialPort = port
    return port
}

// 시리얼 읽기 루프 시작
// startSerialReadLoop에 중단 메커니즘 추가
export const startSerialReadLoop = async (
    port,
    protocol,
    onMessage,
    onByte,
    onError,
    onStatusChange,
    readerRef = null,
    shouldStopRef = null // 중단 신호용 ref 추가
) => {
    if (!port || !port.readable) {
        onStatusChange?.('포트 읽기 불가')
        return
    }

    let reader = null

    try {
        if (port.readable.locked) {
            onStatusChange?.('이미 사용 중')
            return
        }

        reader = port.readable.getReader()
        if (readerRef) {
            readerRef.current = reader
        }
        onStatusChange?.('연결됨')

        while (true) {
            // 중단 신호 확인
            if (shouldStopRef?.current) {
                console.log('읽기 루프 중단 요청됨')
                break
            }

            const result = await reader.read()
            if (result.done) {
                onStatusChange?.('연결 끊김')
                break
            }

            if (result.value) {
                // 모든 바이트를 먼저 처리하여 완전한 메시지 생성
                const messages = []
                for (let k = 0; k < result.value.length; k++) {
                    const byte = result.value[k]

                    // 원시 바이트 콜백
                    onByte?.(byte)

                    const message = protocol.feedByte(byte)
                    if (message) {
                        messages.push(message)
                    }
                }

                // 가장 최신 메시지만 처리
                if (messages.length > 0) {
                    const latestMsg = messages[messages.length - 1]
                    onMessage?.(latestMsg)
                }
            }
        }
    } catch (error) {
        if (error.name === 'NetworkError' || error.message?.includes('device has been lost')) {
            console.warn('Serial device disconnected')
            onStatusChange?.('연결 끊김')
        } else {
            console.error('Serial read error:', error)
            onStatusChange?.('오류: ' + error.message)
        }
        onError?.(error)
    } finally {
        if (reader) {
            try {
                await reader.cancel() // cancel 추가
                reader.releaseLock()
            } catch (e) {
                console.warn('리더 해제 실패:', e)
            }
            reader = null
            if (readerRef) {
                readerRef.current = null
            }
        }
    }
}

// 리더 정리 헬퍼 함수 추가
export const stopSerialReadLoop = async (readerRef) => {
    if (readerRef?.current) {
        try {
            await readerRef.current.cancel()
            readerRef.current.releaseLock()
            readerRef.current = null
        } catch (e) {
            console.warn('리더 중단 중 오류:', e)
        }
    }
}

// 메시지에서 ID 추출 (ID 0 또는 1만)
export const extractIdFromMessage = (msg) => {
    if (!msg || !msg.head) return null

    if (msg.head.cmd === HexglMessageCommand.CLASSIFICATION) {
        for (let i = 1; i < msg.head.length; i += 2) {
            const id = msg.data[i]
            if (typeof id === 'undefined') continue

            // ID 0과 1만 처리
            if (id === 0 || id === 1) {
                return id
            }
        }
    } else if (msg.head.cmd === HexglMessageCommand.DETECTION) {
        for (let j = 1; j < msg.head.length; j += 6) {
            if (j + 5 >= msg.head.length) break
            const did = msg.data[j]
            if (typeof did === 'undefined') continue

            // ID 0과 1만 처리
            if (did === 0 || did === 1) {
                return did
            }
        }
    }

    return null
}

