import { useState, useEffect, useRef } from 'react'
import CH_B from '../../assets/game2/CH_B.png'
import CH_L from '../../assets/game2/CH_L.png'
import CH_R from '../../assets/game2/CH_R.png'
import D from '../../assets/game2/D.png'
import G from '../../assets/game2/G.png'
import H from '../../assets/game2/H.png'
import C from '../../assets/game2/C.png'
import {
    HexglAiCamProtocol,
    HexglMessageCommand,
    requestSerialConnection as requestSerial,
    startSerialReadLoop,
    extractIdFromMessage,
    stopSerialReadLoop
} from './utils/serial'
import { getHighScore } from '../../utils/scoreManager'

// 기본 게임 크기 (비율 기준)
const BASE_GAME_WIDTH = 800
const BASE_GAME_HEIGHT = 600
const BASE_GROUND_HEIGHT = 50
const BASE_CHARACTER_WIDTH = 80  // 2배 증가 (40 -> 80)
const BASE_CHARACTER_HEIGHT = 120  // 2배 증가 (60 -> 120)
const BASE_POOP_WIDTH = 60  // 2배 증가 (30 -> 60)
const BASE_POOP_HEIGHT = 60  // 2배 증가 (30 -> 60)
const BASE_HEART_SIZE = 20
const BASE_CLOUD_WIDTH = 80
const BASE_CLOUD_HEIGHT = 50
const BASE_GROUND_TILE_WIDTH = 600  // 3배 증가 (200 -> 600)
const BASE_CHARACTER_SPEED = 5
const POOP_SPAWN_RATE = 0.02  // 2배 감소 (0.04 -> 0.02)
const BASE_POOP_FALL_SPEED = 3
const SCORE_PER_POOP = 10

function Play({ onGameOver, serialReaderRef, shouldStopRef, onBack }) {
    const [windowSize, setWindowSize] = useState({
        width: window.innerWidth,
        height: window.innerHeight
    })
    const [characterX, setCharacterX] = useState(0)
    const [characterDirection, setCharacterDirection] = useState('B') // B, L, R, S (hurt)
    const [poops, setPoops] = useState([])
    const [lives, setLives] = useState(3)
    const [score, setScore] = useState(0)
    const [highScore, setHighScore] = useState(0)
    const gameLoopRef = useRef(null)
    const poopsRef = useRef([])
    const characterXRef = useRef(0)
    const livesRef = useRef(3)
    const scoreRef = useRef(0)
    const keysRef = useRef({ left: false, right: false })
    const scaleRef = useRef(1)
    const serialProtocolRef = useRef(new HexglAiCamProtocol())
    const serialPortRef = useRef(null)
    const serialConnectedRef = useRef(false)
    const [serialStatus, setSerialStatus] = useState('연결 안됨')
    const [showDebugModal, setShowDebugModal] = useState(false)
    const [rawBytes, setRawBytes] = useState([])
    const [parsedMessages, setParsedMessages] = useState([])
    const latestMessageRef = useRef(null) // 가장 최신 메시지 저장
    const messageTimeoutRef = useRef(null) // 메시지 타임아웃

    // 화면 크기 계산
    useEffect(() => {
        const handleResize = () => {
            setWindowSize({
                width: window.innerWidth,
                height: window.innerHeight
            })
        }

        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [])

    // 스케일 계산
    const scaleX = windowSize.width / BASE_GAME_WIDTH
    const scaleY = windowSize.height / BASE_GAME_HEIGHT
    const scale = Math.min(scaleX, scaleY)
    scaleRef.current = scale

    // 스케일된 크기 계산
    const GAME_WIDTH = windowSize.width
    const GAME_HEIGHT = windowSize.height
    const GROUND_HEIGHT = BASE_GROUND_HEIGHT * scale
    const CHARACTER_WIDTH = BASE_CHARACTER_WIDTH * scale
    const CHARACTER_HEIGHT = BASE_CHARACTER_HEIGHT * scale
    const POOP_WIDTH = BASE_POOP_WIDTH * scale
    const POOP_HEIGHT = BASE_POOP_HEIGHT * scale
    const HEART_SIZE = BASE_HEART_SIZE * scale
    const CLOUD_WIDTH = BASE_CLOUD_WIDTH * scale
    const CLOUD_HEIGHT = BASE_CLOUD_HEIGHT * scale
    const GROUND_TILE_WIDTH = BASE_GROUND_TILE_WIDTH * scale
    const CHARACTER_SPEED = BASE_CHARACTER_SPEED * scale
    const POOP_FALL_SPEED = BASE_POOP_FALL_SPEED * scale
    const FONT_SIZE = 24 * scale

    // 캐릭터 초기 위치 설정
    useEffect(() => {
        const initialX = GAME_WIDTH / 2 - CHARACTER_WIDTH / 2
        characterXRef.current = initialX
        setCharacterX(initialX)
    }, [GAME_WIDTH, CHARACTER_WIDTH])

    // 키보드 폴백 (시리얼이 없을 때 사용)
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
                keysRef.current.left = true
                setCharacterDirection('L')
            }
            if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
                keysRef.current.right = true
                setCharacterDirection('R')
            }
        }

        const handleKeyUp = (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
                keysRef.current.left = false
                if (!keysRef.current.right) setCharacterDirection('B')
            }
            if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
                keysRef.current.right = false
                if (!keysRef.current.left) setCharacterDirection('B')
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        window.addEventListener('keyup', handleKeyUp)

        return () => {
            window.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('keyup', handleKeyUp)
        }
    }, [])

    // 시리얼 통신 설정
    useEffect(() => {
        let isMounted = true

        const initSerial = async () => {
            console.log('Play 컴포넌트 마운트 - 시리얼 초기화 시작')
            console.log('window.serialPort:', window.serialPort)
            console.log('shouldStopRef.current:', shouldStopRef?.current)

            // 중단 신호 해제
            if (shouldStopRef) {
                shouldStopRef.current = false
            }

            // 전역 시리얼 포트가 있으면 그대로 사용
            if (window.serialPort && window.serialPort.readable) {
                console.log('전역 시리얼 포트 발견 - 읽기 루프 시작')
                serialPortRef.current = window.serialPort
                serialProtocolRef.current.reset()

                if (isMounted) {
                    setSerialStatus('연결 중...')
                    await startSerialReadLoopLocal()
                }
            } else {
                console.log('전역 시리얼 포트가 없거나 readable이 없습니다')
                if (isMounted) {
                    setSerialStatus('연결 안됨')
                }
            }
        }

        initSerial()

        return () => {
            console.log('Play 컴포넌트 언마운트 - 시리얼 정리')
            isMounted = false

            // 중단 신호 설정
            if (shouldStopRef) {
                shouldStopRef.current = true
            }

            // 리더 정리
            if (serialReaderRef?.current) {
                stopSerialReadLoop(serialReaderRef).catch(() => { })
            }
        }
    }, [])

    // 시리얼 메시지 처리 (가장 최신 메시지만 처리)
    const handleSerialMessage = (msg) => {
        if (!msg || !msg.head) return

        // 가장 최신 메시지로 저장
        latestMessageRef.current = {
            timestamp: Date.now(),
            msg: msg
        }

        // 디버깅: 파싱된 메시지 저장
        const parsedMsg = {
            timestamp: new Date().toLocaleTimeString(),
            cmd: msg.head.cmd,
            length: msg.head.length,
            data: [...msg.data],
            crc: msg.crc
        }
        setParsedMessages(prev => {
            const newList = [parsedMsg, ...prev].slice(0, 100) // 최대 100개 유지
            return newList
        })

        // 기존 타임아웃 취소
        if (messageTimeoutRef.current) {
            clearTimeout(messageTimeoutRef.current)
        }

        // 메시지에서 ID 추출 및 처리
        let foundId = null

        if (msg.head.cmd === HexglMessageCommand.CLASSIFICATION) {
            const type = msg.data && msg.data.length > 0 ? msg.data[0] : null
            for (let i = 1; i < msg.head.length; i += 2) {
                const id = msg.data[i]
                const confidence = msg.data[i + 1]
                if (typeof id === 'undefined') continue

                // ID 0과 1만 처리
                if (id === 0 || id === 1) {
                    foundId = id
                    break // 첫 번째 유효한 ID만 사용
                }
            }
        } else if (msg.head.cmd === HexglMessageCommand.DETECTION) {
            const dtype = msg.data && msg.data.length > 0 ? msg.data[0] : null
            for (let j = 1; j < msg.head.length; j += 6) {
                if (j + 5 >= msg.head.length) break
                const did = msg.data[j]
                const dconfidence = msg.data[j + 5]
                if (typeof did === 'undefined') continue

                // ID 0과 1만 처리
                if (did === 0 || did === 1) {
                    foundId = did
                    break // 첫 번째 유효한 ID만 사용
                }
            }
        }

        // ID에 따라 키 설정
        if (foundId === 0) {
            keysRef.current.left = true
            keysRef.current.right = false
            setCharacterDirection('L')
        } else if (foundId === 1) {
            keysRef.current.left = false
            keysRef.current.right = true
            setCharacterDirection('R')
        } else {
            // ID 0, 1이 없으면 키 해제
            keysRef.current.left = false
            keysRef.current.right = false
            setCharacterDirection('B')
        }

        // 200ms 후 메시지가 오지 않으면 멈춤
        messageTimeoutRef.current = setTimeout(() => {
            keysRef.current.left = false
            keysRef.current.right = false
            setCharacterDirection('B')
            messageTimeoutRef.current = null
        }, 200)
    }

    // 게임 루프에서 최신 메시지 처리 (추가 안전장치)
    useEffect(() => {
        const processLatestMessage = setInterval(() => {
            if (latestMessageRef.current) {
                const now = Date.now()
                // 300ms 이상 지난 메시지는 무시 (너무 오래된 메시지)
                if (now - latestMessageRef.current.timestamp < 300) {
                    // 최신 메시지가 있으면 계속 처리
                    return
                } else {
                    // 오래된 메시지는 무시하고 멈춤
                    keysRef.current.left = false
                    keysRef.current.right = false
                    setCharacterDirection('B')
                }
            }
        }, 50) // 50ms마다 체크

        return () => clearInterval(processLatestMessage)
    }, [])

    // 최고 점수 로드
    useEffect(() => {
        const loadHighScore = async () => {
            const result = await getHighScore('score_2')
            if (result.success) {
                setHighScore(result.highScore || 0)
            }
        }
        loadHighScore()
    }, [])

    // 시리얼 읽기 루프 시작
    const startSerialReadLoopLocal = async () => {
        if (!serialPortRef.current) {
            setSerialStatus('포트 없음')
            return
        }

        // 포트가 잠겨있으면 해제 대기
        if (serialPortRef.current.readable && serialPortRef.current.readable.locked) {
            console.warn('Port is locked, waiting for release...')
            let attempts = 0
            while (serialPortRef.current.readable.locked && attempts < 20) {
                await new Promise(resolve => setTimeout(resolve, 50))
                attempts++
            }

            if (serialPortRef.current.readable.locked) {
                setSerialStatus('포트가 잠겨있습니다')
                return
            }
        }

        serialConnectedRef.current = true
        await startSerialReadLoop(
            serialPortRef.current,
            serialProtocolRef.current,
            handleSerialMessage,
            (byte) => {
                // 디버깅: 원시 바이트 저장
                setRawBytes(prev => {
                    const newList = [{
                        timestamp: new Date().toLocaleTimeString(),
                        value: byte,
                        hex: '0x' + ('0' + byte.toString(16).toUpperCase()).slice(-2)
                    }, ...prev].slice(0, 200) // 최대 200개 유지
                    return newList
                })
            },
            (error) => {
                console.error('Serial error:', error)
                serialConnectedRef.current = false
            },
            (status) => {
                setSerialStatus(status)
            },
            serialReaderRef,
            shouldStopRef
        )
        serialConnectedRef.current = false
    }

    // 시리얼 연결 요청
    const requestSerialConnection = async () => {
        if (serialPortRef.current && serialPortRef.current.readable) {
            // 포트가 잠겨있지 않으면 이미 연결된 것으로 간주
            if (!serialPortRef.current.readable.locked) {
                setSerialStatus('이미 연결됨')
                return
            }
        }

        setSerialStatus('연결 중...')

        try {
            // 기존 포트가 있으면 먼저 정리
            if (serialPortRef.current && serialPortRef.current.readable) {
                // 잠겨있으면 해제 대기
                if (serialPortRef.current.readable.locked) {
                    console.warn('Existing port is locked, waiting for release...')
                    let attempts = 0
                    while (serialPortRef.current.readable.locked && attempts < 20) {
                        await new Promise(resolve => setTimeout(resolve, 50))
                        attempts++
                    }
                }
            }

            const port = await requestSerial()
            serialPortRef.current = port
            serialProtocolRef.current.reset()
            setSerialStatus('연결됨')
            startSerialReadLoopLocal()
        } catch (error) {
            if (error.name === 'NotFoundError') {
                setSerialStatus('연결 취소됨')
            } else {
                console.error('Serial connection failed:', error)
                setSerialStatus('연결 실패: ' + error.message)
            }
        }
    }

    // 게임 루프
    useEffect(() => {
        gameLoopRef.current = setInterval(() => {
            const currentScale = scaleRef.current
            const currentGameWidth = windowSize.width
            const currentGameHeight = windowSize.height
            const currentCharacterWidth = BASE_CHARACTER_WIDTH * currentScale
            const currentCharacterHeight = BASE_CHARACTER_HEIGHT * currentScale
            const currentPoopWidth = BASE_POOP_WIDTH * currentScale
            const currentPoopHeight = BASE_POOP_HEIGHT * currentScale
            const currentGroundHeight = BASE_GROUND_HEIGHT * currentScale
            const currentCharacterSpeed = BASE_CHARACTER_SPEED * currentScale
            const currentPoopFallSpeed = BASE_POOP_FALL_SPEED * currentScale

            // 캐릭터 이동
            let newX = characterXRef.current
            if (keysRef.current.left && newX > 0) {
                newX = Math.max(0, newX - currentCharacterSpeed)
                setCharacterDirection('L')
            }
            if (keysRef.current.right && newX < currentGameWidth - currentCharacterWidth) {
                newX = Math.min(currentGameWidth - currentCharacterWidth, newX + currentCharacterSpeed)
                setCharacterDirection('R')
            }
            if (!keysRef.current.left && !keysRef.current.right) {
                setCharacterDirection('B')
            }

            characterXRef.current = newX
            setCharacterX(newX)

            // 똥 생성
            if (Math.random() < POOP_SPAWN_RATE) {
                const newPoop = {
                    id: Date.now() + Math.random(),
                    x: Math.random() * (currentGameWidth - currentPoopWidth),
                    y: -currentPoopHeight
                }
                poopsRef.current = [...poopsRef.current, newPoop]
                setPoops([...poopsRef.current])
            }

            // 똥 떨어뜨리기
            poopsRef.current = poopsRef.current
                .map(poop => ({
                    ...poop,
                    y: poop.y + currentPoopFallSpeed
                }))
                .filter(poop => {
                    // 화면 밖으로 나간 똥은 제거하고 점수 추가
                    if (poop.y > currentGameHeight) {
                        scoreRef.current += SCORE_PER_POOP
                        setScore(scoreRef.current)
                        return false
                    }
                    return true
                })

            // 충돌 감지
            const charY = currentGameHeight - currentGroundHeight - currentCharacterHeight
            poopsRef.current.forEach((poop, index) => {
                if (
                    poop.x < characterXRef.current + currentCharacterWidth &&
                    poop.x + currentPoopWidth > characterXRef.current &&
                    poop.y < charY + currentCharacterHeight &&
                    poop.y + currentPoopHeight > charY
                ) {
                    // 충돌 발생
                    poopsRef.current = poopsRef.current.filter((_, i) => i !== index)
                    setPoops([...poopsRef.current])

                    livesRef.current -= 1
                    setLives(livesRef.current)

                    if (livesRef.current <= 0) {
                        clearInterval(gameLoopRef.current)
                        onGameOver(scoreRef.current)
                    }
                }
            })

            setPoops([...poopsRef.current])
        }, 16) // 약 60fps

        return () => {
            if (gameLoopRef.current) {
                clearInterval(gameLoopRef.current)
            }
        }
    }, [onGameOver, windowSize])

    // 구름 위치 (비율에 맞게 조정)
    const clouds = [
        { x: (100 / BASE_GAME_WIDTH) * GAME_WIDTH, y: (50 / BASE_GAME_HEIGHT) * GAME_HEIGHT },
        { x: (500 / BASE_GAME_WIDTH) * GAME_WIDTH, y: (80 / BASE_GAME_HEIGHT) * GAME_HEIGHT }
    ]

    // 땅 타일 개수 계산 (화면 전체를 덮도록, 50% 겹치게 배치)
    const tileSpacing = GROUND_TILE_WIDTH * 0.5  // 50% 겹침
    const groundTiles = Math.ceil(GAME_WIDTH / tileSpacing) + 2

    return (
        <div
            style={{
                width: '100vw',
                height: '100vh',
                backgroundColor: '#87CEEB',
                position: 'relative',
                overflow: 'hidden',
                margin: 0,
                padding: 0
            }}
        >
            {/* 구름 */}
            {clouds.map((cloud, index) => (
                <img
                    key={index}
                    src={C}
                    alt="cloud"
                    style={{
                        position: 'absolute',
                        left: cloud.x,
                        top: cloud.y,
                        width: CLOUD_WIDTH,
                        height: CLOUD_HEIGHT,
                        imageRendering: 'pixelated'
                    }}
                />
            ))}

            {/* 똥 */}
            {poops.map(poop => (
                <img
                    key={poop.id}
                    src={D}
                    alt="poop"
                    style={{
                        position: 'absolute',
                        left: poop.x,
                        top: poop.y,
                        width: POOP_WIDTH,
                        height: POOP_HEIGHT,
                        imageRendering: 'pixelated'
                    }}
                />
            ))}

            {/* 캐릭터 - 땅 타일 바로 위에 위치 (높이 기준으로 크기 통일) */}
            <img
                src={
                    characterDirection === 'L' ? CH_L :
                        characterDirection === 'R' ? CH_R : CH_B
                }
                alt="character"
                style={{
                    position: 'absolute',
                    left: characterX,
                    bottom: GROUND_HEIGHT,  // 땅 높이만큼 위에 위치하여 땅 바로 위에 붙음
                    height: CHARACTER_HEIGHT,  // 높이 기준으로 통일
                    width: 'auto',  // 너비는 원본 비율에 맞게 자동 조정
                    imageRendering: 'pixelated',
                    objectFit: 'contain',
                    objectPosition: 'bottom'  // 이미지 하단을 기준으로 정렬
                }}
            />

            {/* 땅 - 타일을 겹치게 배치하여 빈틈 제거 */}
            {Array.from({ length: groundTiles }).map((_, i) => {
                const tileX = i * tileSpacing
                return (
                    <img
                        key={i}
                        src={G}
                        alt="ground"
                        style={{
                            position: 'absolute',
                            left: tileX,
                            top: GAME_HEIGHT - GROUND_HEIGHT,
                            width: GROUND_TILE_WIDTH,
                            height: GROUND_HEIGHT,
                            imageRendering: 'pixelated'
                        }}
                    />
                )
            })}

            {/* UI - 생명 */}
            <div
                style={{
                    position: 'absolute',
                    top: onBack ? (50 * scale) : (10 * scale),
                    left: 10 * scale,
                    display: 'flex',
                    gap: 5 * scale
                }}
            >
                {Array.from({ length: 3 }).map((_, i) => (
                    <img
                        key={i}
                        src={H}
                        alt="heart"
                        style={{
                            width: HEART_SIZE,
                            height: HEART_SIZE,
                            imageRendering: 'pixelated',
                            opacity: i < lives ? 1 : 0.3
                        }}
                    />
                ))}
            </div>

            {/* UI - 점수 */}
            <div
                style={{
                    position: 'absolute',
                    top: 10 * scale,
                    right: 10 * scale,
                    color: '#fff',
                    fontSize: `${FONT_SIZE}px`,
                    fontWeight: 'bold',
                    textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '5px',
                    alignItems: 'flex-end'
                }}
            >
                <div>Score: {score}</div>
                <div style={{ fontSize: `${FONT_SIZE * 0.8}px`, opacity: 0.8 }}>High: {highScore}</div>
            </div>

            {/* 뒤로가기 버튼 */}
            {onBack && (
                <button
                    onClick={async () => {
                        // 게임 루프 정리
                        if (gameLoopRef.current) {
                            clearInterval(gameLoopRef.current)
                            gameLoopRef.current = null
                        }
                        // 시리얼 리더 정리
                        if (shouldStopRef) {
                            shouldStopRef.current = true
                        }
                        if (serialReaderRef?.current) {
                            await stopSerialReadLoop(serialReaderRef)
                        }
                        onBack()
                    }}
                    style={{
                        position: 'absolute',
                        top: 10 * scale,
                        left: 10 * scale,
                        padding: `${8 * scale}px ${16 * scale}px`,
                        fontSize: `${14 * scale}px`,
                        backgroundColor: '#f44336',
                        color: '#fff',
                        border: 'none',
                        borderRadius: `${4 * scale}px`,
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        textShadow: '1px 1px 2px rgba(0,0,0,0.5)',
                        zIndex: 1001
                    }}
                >
                    뒤로가기
                </button>
            )}

            {/* 시리얼 제어 패널 */}
            <div
                style={{
                    position: 'absolute',
                    bottom: 10 * scale,
                    left: 10 * scale,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8 * scale,
                    zIndex: 1000
                }}
            >
                <div
                    style={{
                        color: '#fff',
                        fontSize: `${12 * scale}px`,
                        textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
                        backgroundColor: 'rgba(0,0,0,0.5)',
                        padding: `${4 * scale}px ${8 * scale}px`,
                        borderRadius: `${4 * scale}px`
                    }}
                >
                    시리얼: {serialStatus}
                </div>
                <div style={{ display: 'flex', gap: 8 * scale }}>
                    <button
                        onClick={requestSerialConnection}
                        disabled={serialConnectedRef.current}
                        style={{
                            padding: `${6 * scale}px ${12 * scale}px`,
                            fontSize: `${12 * scale}px`,
                            backgroundColor: serialConnectedRef.current ? '#666' : '#4CAF50',
                            color: '#fff',
                            border: 'none',
                            borderRadius: `${4 * scale}px`,
                            cursor: serialConnectedRef.current ? 'not-allowed' : 'pointer',
                            fontWeight: 'bold',
                            textShadow: '1px 1px 2px rgba(0,0,0,0.5)'
                        }}
                    >
                        시리얼 연결
                    </button>
                    <button
                        onClick={() => setShowDebugModal(true)}
                        style={{
                            padding: `${6 * scale}px ${12 * scale}px`,
                            fontSize: `${12 * scale}px`,
                            backgroundColor: '#2196F3',
                            color: '#fff',
                            border: 'none',
                            borderRadius: `${4 * scale}px`,
                            cursor: 'pointer',
                            fontWeight: 'bold',
                            textShadow: '1px 1px 2px rgba(0,0,0,0.5)'
                        }}
                    >
                        디버깅
                    </button>
                </div>
            </div>

            {/* 디버깅 모달 */}
            {showDebugModal && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        backgroundColor: 'rgba(0,0,0,0.7)',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        zIndex: 10000
                    }}
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            setShowDebugModal(false)
                        }
                    }}
                >
                    <div
                        style={{
                            backgroundColor: '#1a1a1a',
                            border: '2px solid #444',
                            borderRadius: '8px',
                            width: '90%',
                            maxWidth: '900px',
                            maxHeight: '80vh',
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* 헤더 */}
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '16px',
                                borderBottom: '1px solid #444',
                                backgroundColor: '#2a2a2a'
                            }}
                        >
                            <h2 style={{ color: '#fff', margin: 0, fontSize: '18px' }}>시리얼 디버깅</h2>
                            <button
                                onClick={() => setShowDebugModal(false)}
                                style={{
                                    padding: '8px 16px',
                                    backgroundColor: '#f44336',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold'
                                }}
                            >
                                닫기
                            </button>
                        </div>

                        {/* 본문 */}
                        <div
                            style={{
                                display: 'flex',
                                flex: 1,
                                overflow: 'hidden'
                            }}
                        >
                            {/* 원시 바이트 */}
                            <div
                                style={{
                                    flex: 1,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    borderRight: '1px solid #444'
                                }}
                            >
                                <div
                                    style={{
                                        padding: '12px',
                                        backgroundColor: '#2a2a2a',
                                        borderBottom: '1px solid #444',
                                        fontWeight: 'bold',
                                        color: '#fff'
                                    }}
                                >
                                    원시 바이트 ({rawBytes.length})
                                </div>
                                <div
                                    style={{
                                        flex: 1,
                                        overflowY: 'auto',
                                        padding: '12px',
                                        fontFamily: 'monospace',
                                        fontSize: '12px',
                                        color: '#fff',
                                        backgroundColor: '#1a1a1a'
                                    }}
                                >
                                    {rawBytes.length === 0 ? (
                                        <div style={{ color: '#888' }}>데이터 없음</div>
                                    ) : (
                                        rawBytes.map((item, index) => (
                                            <div
                                                key={index}
                                                style={{
                                                    marginBottom: '4px',
                                                    padding: '4px',
                                                    backgroundColor: index === 0 ? '#333' : 'transparent'
                                                }}
                                            >
                                                {item.timestamp} → {item.hex} ({item.value})
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            {/* 파싱된 메시지 */}
                            <div
                                style={{
                                    flex: 1,
                                    display: 'flex',
                                    flexDirection: 'column'
                                }}
                            >
                                <div
                                    style={{
                                        padding: '12px',
                                        backgroundColor: '#2a2a2a',
                                        borderBottom: '1px solid #444',
                                        fontWeight: 'bold',
                                        color: '#fff'
                                    }}
                                >
                                    파싱된 메시지 ({parsedMessages.length})
                                </div>
                                <div
                                    style={{
                                        flex: 1,
                                        overflowY: 'auto',
                                        padding: '12px',
                                        fontFamily: 'monospace',
                                        fontSize: '12px',
                                        color: '#fff',
                                        backgroundColor: '#1a1a1a'
                                    }}
                                >
                                    {parsedMessages.length === 0 ? (
                                        <div style={{ color: '#888' }}>메시지 없음</div>
                                    ) : (
                                        parsedMessages.map((msg, index) => (
                                            <div
                                                key={index}
                                                style={{
                                                    marginBottom: '8px',
                                                    padding: '8px',
                                                    backgroundColor: index === 0 ? '#333' : 'transparent',
                                                    borderBottom: '1px solid #333'
                                                }}
                                            >
                                                <div style={{ color: '#4CAF50', marginBottom: '4px' }}>
                                                    {msg.timestamp}
                                                </div>
                                                <div>
                                                    <strong>CMD:</strong> {msg.cmd} (
                                                    {msg.cmd === HexglMessageCommand.CLASSIFICATION ? 'CLASSIFICATION' :
                                                        msg.cmd === HexglMessageCommand.DETECTION ? 'DETECTION' :
                                                            msg.cmd === HexglMessageCommand.KEYPOINT_BOX_DETECTION ? 'KEYPOINT_BOX_DETECTION' : 'UNKNOWN'})
                                                </div>
                                                <div>
                                                    <strong>Length:</strong> {msg.length}
                                                </div>
                                                <div>
                                                    <strong>Data:</strong> [{msg.data.join(', ')}]
                                                </div>
                                                {msg.cmd === HexglMessageCommand.CLASSIFICATION && msg.data.length >= 3 && (
                                                    <div style={{ color: '#FFC107', marginTop: '4px' }}>
                                                        ID: {msg.data[1]}, Confidence: {msg.data[2]}
                                                    </div>
                                                )}
                                                {msg.cmd === HexglMessageCommand.DETECTION && msg.data.length >= 7 && (
                                                    <div style={{ color: '#FFC107', marginTop: '4px' }}>
                                                        ID: {msg.data[1]}, Center: ({msg.data[2]}, {msg.data[3]}), Size: {msg.data[4]}x{msg.data[5]}, Confidence: {msg.data[6]}
                                                    </div>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default Play

