import { useState, useEffect, useRef } from 'react'
import M from '../../assets/game3/M.png'
import L from '../../assets/game3/L.png'
import R from '../../assets/game3/R.png'
import Water from '../../assets/game3/Water.png'
import F from '../../assets/game3/F.png'
import B from '../../assets/game3/B.png'
import Grass from '../../assets/game3/Grass.png'
import H from '../../assets/game3/H.png'
import {
    HexglAiCamProtocol,
    HexglMessageCommand,
    requestSerialConnection as requestSerial,
    startSerialReadLoop as startSerialRead,
    extractIdFromMessage,
    stopSerialReadLoop
} from './utils/serial.js'

// 기본 게임 크기 (비율 기준)
const BASE_GAME_WIDTH = 800
const BASE_GAME_HEIGHT = 600
const BASE_CHARACTER_WIDTH = 240  // 80 * 3
const BASE_CHARACTER_HEIGHT = 240  // 너비와 비슷하게 조정 (원래 120 * 3이었지만 높이가 너무 높음)
const BASE_WATER_WIDTH = 60
const BASE_WATER_HEIGHT = 60
const BASE_HEART_SIZE = 20
const BASE_GRASS_WIDTH = 40
const BASE_ROAD_WIDTH = 200  // 차도 너비
const BASE_ROAD_HEIGHT = 600  // 차도 높이 (전체 화면)
const NUM_LANES = 3  // 차도 개수
const BASE_WATER_SPAWN_RATE = 0.015  // 웅덩이 생성 확률
const BASE_WATER_FALL_SPEED = 3
const BASE_LANE_CHANGE_SPEED = 8  // 차도 변경 속도
const SCORE_PER_WATER = 10  // 웅덩이를 피하면 점수 획득

function Play({ onGameOver, serialReaderRef, shouldStopRef, onBack }) {
    const [windowSize, setWindowSize] = useState({
        width: window.innerWidth,
        height: window.innerHeight
    })
    const [characterY, setCharacterY] = useState(0)  // 캐릭터 Y 위치 (차도 내에서의 위치, 화면 하단 기준)
    const [targetLane, setTargetLane] = useState(1)  // 목표 차도 (0, 1, 2)
    const [currentLaneX, setCurrentLaneX] = useState(0)  // 현재 차도의 X 위치 (부드러운 이동을 위해)
    const [characterDirection, setCharacterDirection] = useState('R') // L (왼쪽 이동), R (오른쪽 이동), M 사용 안함
    const [isArrived, setIsArrived] = useState(true) // 목표 차도에 도착했는지 여부
    const characterImageRef = useRef(null) // 캐릭터 이미지 DOM 참조
    const [waters, setWaters] = useState([])  // 웅덩이와 꽃 배열
    const [lives, setLives] = useState(3)
    const [score, setScore] = useState(0)
    const gameLoopRef = useRef(null)
    const watersRef = useRef([])
    const characterYRef = useRef(0)
    const targetLaneRef = useRef(1)
    const currentLaneXRef = useRef(0)
    const movingDirectionRef = useRef(null) // 이동 방향 저장 ('L' 또는 'R', 목표 도달 시 null)
    const livesRef = useRef(3)
    const scoreRef = useRef(0)
    const scaleRef = useRef(1)
    const waterSpawnYRef = useRef(0) // 마지막 웅덩이 생성 위치 (Y 좌표, 초기값은 화면 상단 위)
    const lastWaterSpawnTimeRef = useRef(0) // 마지막 웅덩이 생성 시간
    const waterLaneIndexRef = useRef(0) // 다음에 생성할 차도 인덱스 (0, 1, 2 순환)
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
    const CHARACTER_WIDTH = BASE_CHARACTER_WIDTH * scale
    const CHARACTER_HEIGHT = BASE_CHARACTER_HEIGHT * scale
    const WATER_WIDTH = BASE_WATER_WIDTH * scale
    const WATER_HEIGHT = BASE_WATER_HEIGHT * scale
    const HEART_SIZE = BASE_HEART_SIZE * scale
    const GRASS_WIDTH = BASE_GRASS_WIDTH * scale
    const ROAD_WIDTH = BASE_ROAD_WIDTH * scale
    const ROAD_HEIGHT = BASE_ROAD_HEIGHT * scale
    const WATER_FALL_SPEED = BASE_WATER_FALL_SPEED * scale
    const LANE_CHANGE_SPEED = BASE_LANE_CHANGE_SPEED * scale
    const FONT_SIZE = 24 * scale

    // 차도 위치 계산 함수들 (useMemo로 최적화)
    const laneCalculations = (() => {
        const grassWidth = GRASS_WIDTH
        const totalGrassWidth = grassWidth * (NUM_LANES - 1)
        const totalRoadWidth = ROAD_WIDTH * NUM_LANES
        const totalWidth = totalRoadWidth + totalGrassWidth
        const startX = (GAME_WIDTH - totalWidth) / 2

        return {
            grassWidth,
            startX,
            getLaneX: (laneIndex) => startX + (laneIndex * (ROAD_WIDTH + grassWidth)),
            getLaneCenterX: (laneIndex) => startX + (laneIndex * (ROAD_WIDTH + grassWidth)) + (ROAD_WIDTH / 2)
        }
    })()

    // 캐릭터 초기 위치 설정
    useEffect(() => {
        const initialLaneX = laneCalculations.getLaneCenterX(1) - ROAD_WIDTH / 2
        currentLaneXRef.current = initialLaneX
        setCurrentLaneX(initialLaneX)
        characterYRef.current = 0
        setCharacterY(0)
        targetLaneRef.current = 1
        setTargetLane(1)
        setIsArrived(true) // 초기 위치는 목표 차도에 도착한 상태
        // 웅덩이 생성 위치 및 타이머 초기화
        waterSpawnYRef.current = -100
        lastWaterSpawnTimeRef.current = Date.now()
        waterLaneIndexRef.current = 0
        watersRef.current = []
        setWaters([])
    }, [GAME_WIDTH, ROAD_WIDTH])

    // 키보드 폴백 (시리얼이 없을 때 사용)
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
                // 왼쪽 차도로 이동 (0 -> 1 -> 2 순서가 아니라 화면 기준 왼쪽)
                const newLane = Math.max(0, targetLaneRef.current - 1)
                targetLaneRef.current = newLane
                setTargetLane(newLane)
                setCharacterDirection('L')
            }
            if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
                // 오른쪽 차도로 이동
                const newLane = Math.min(NUM_LANES - 1, targetLaneRef.current + 1)
                targetLaneRef.current = newLane
                setTargetLane(newLane)
                setCharacterDirection('R')
            }
        }

        const handleKeyUp = (e) => {
            // 키를 떼어도 방향 유지 (M 사용 안함)
            // setCharacterDirection은 변경하지 않음
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
                stopSerialReadLoop(serialReaderRef, shouldStopRef).catch(() => { })
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

        // utils/serial.js의 extractIdFromMessage 사용
        const foundId = extractIdFromMessage(msg)

        console.log('시리얼 메시지 받음:', {
            cmd: msg.head.cmd,
            length: msg.head.length,
            dataLength: msg.data.length,
            data: msg.data,
            foundId: foundId
        })

        // ID에 따라 차도 설정 (0, 1, 2)
        if (foundId === 0 || foundId === 1 || foundId === 2) {
            const oldLane = targetLaneRef.current
            console.log('차도 변경:', { oldLane, newLane: foundId })
            if (oldLane !== foundId) {
                // 목표 차도가 변경되면 도착하지 않은 상태로 설정
                setIsArrived(false)

                // 이동 방향 설정 (더 큰 ID = R, 더 작은 ID = L)
                if (foundId < oldLane) {
                    setCharacterDirection('L')
                    movingDirectionRef.current = 'L'
                } else if (foundId > oldLane) {
                    setCharacterDirection('R')
                    movingDirectionRef.current = 'R'
                }

                targetLaneRef.current = foundId
                setTargetLane(foundId)
            } else {
                // 같은 차도면 도착한 상태로 설정, 방향은 유지 (M 사용 안함)
                setIsArrived(true)
                // characterDirection과 movingDirectionRef는 그대로 유지
            }
        } else {
            console.log('유효한 ID 없음, foundId:', foundId)
            // 유효하지 않은 ID는 이동 방향 유지 (목표 도달 전까지)
        }

        // 타임아웃 제거 - 게임 루프에서 목표 도달 시 M으로 변경
        if (messageTimeoutRef.current) {
            clearTimeout(messageTimeoutRef.current)
            messageTimeoutRef.current = null
        }
    }

    // 게임 루프에서 최신 메시지 처리 제거
    // 이동 방향은 handleSerialMessage에서 설정하고, 목표 도달 시 게임 루프에서 M으로 변경

    // 시리얼 읽기 루프 (utils/serial.js 사용)
    const startSerialReadLoopLocal = async () => {
        if (!serialPortRef.current) {
            console.error('시리얼 포트가 없습니다')
            setSerialStatus('포트 없음')
            return
        }

        if (!serialPortRef.current.readable) {
            console.error('시리얼 포트 readable이 없습니다')
            setSerialStatus('포트 읽기 불가')
            return
        }

        // 포트가 이미 잠겨있으면 먼저 해제
        if (serialPortRef.current.readable.locked) {
            console.log('포트가 잠겨있음 - 기존 리더 정리 시도')
            // 기존 리더 정리
            await stopSerialReadLoop(serialReaderRef, shouldStopRef)

            // 약간의 지연 후 재시도
            await new Promise(resolve => setTimeout(resolve, 100))

            // 여전히 잠겨있으면 실패
            if (serialPortRef.current.readable.locked) {
                console.error('포트 잠금 해제 실패')
                setSerialStatus('포트 잠금 해제 실패')
                return
            }

            // 중단 신호 해제 (새로운 읽기 루프를 시작하기 위해)
            if (shouldStopRef) {
                shouldStopRef.current = false
            }
        }

        console.log('시리얼 읽기 루프 시작')
        serialConnectedRef.current = true

        try {
            // utils/serial.js의 startSerialReadLoop 사용
            await startSerialRead(
                serialPortRef.current,
                serialProtocolRef.current,
                (msg) => {
                    // 메시지 처리
                    handleSerialMessage(msg)
                },
                (byte) => {
                    // 원시 바이트 디버깅
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
                    // 에러 처리
                    console.error('Serial read error:', error)
                    serialConnectedRef.current = false
                },
                (status) => {
                    // 상태 변경
                    console.log('시리얼 상태 변경:', status)
                    setSerialStatus(status)
                },
                serialReaderRef, // 리더 참조 전달 (게임 종료 시 해제용)
                shouldStopRef // 중단 신호 ref 전달
            )
        } catch (error) {
            console.error('startSerialReadLoopLocal 에러:', error)
            setSerialStatus('읽기 루프 오류: ' + error.message)
            serialConnectedRef.current = false
        }
    }

    // 시리얼 연결 요청
    const requestSerialConnection = async () => {
        if (typeof navigator === 'undefined' || !navigator.serial) {
            alert('이 브라우저는 Web Serial API를 지원하지 않습니다.')
            return
        }

        // window.serialPort가 이미 있으면 재사용 (게임 재시작 시 유지됨)
        if (window.serialPort && window.serialPort.readable) {
            console.log('기존 전역 포트 발견, 재사용')
            serialPortRef.current = window.serialPort
            serialProtocolRef.current.reset()

            // 기존 포트 그대로 사용
            setSerialStatus('연결 중...')
            await startSerialReadLoopLocal()
            return
        }

        // serialPortRef.current도 체크
        if (serialPortRef.current && serialPortRef.current.readable) {
            console.log('기존 포트 재사용')
            setSerialStatus('연결 중...')
            await startSerialReadLoopLocal()
            return
        }

        setSerialStatus('연결 중...')

        try {
            // 새 포트 연결
            const port = await requestSerial()

            serialPortRef.current = port
            serialProtocolRef.current.reset()
            setSerialStatus('연결됨')
            console.log('새 시리얼 포트 연결 완료, 읽기 루프 시작 요청')
            await startSerialReadLoopLocal()
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
            const currentWaterWidth = BASE_WATER_WIDTH * currentScale
            const currentWaterHeight = BASE_WATER_HEIGHT * currentScale
            const currentWaterFallSpeed = BASE_WATER_FALL_SPEED * currentScale
            const currentLaneChangeSpeed = BASE_LANE_CHANGE_SPEED * currentScale

            // 차도 위치 재계산 (스케일 반영)
            const currentGrassWidth = BASE_GRASS_WIDTH * currentScale
            const currentRoadWidth = BASE_ROAD_WIDTH * currentScale
            const currentCharacterWidth = currentRoadWidth // 도로 폭에 맞춤

            // 실제 렌더링된 캐릭터 높이 계산 (이미지 비율 유지)
            // 원본 이미지 비율을 가정: BASE_CHARACTER_HEIGHT / BASE_CHARACTER_WIDTH
            // 실제 렌더링된 높이 = 너비 * (원본 높이 / 원본 너비)
            const originalAspectRatio = BASE_CHARACTER_HEIGHT / BASE_CHARACTER_WIDTH
            const currentCharacterHeight = currentCharacterWidth * originalAspectRatio
            const currentTotalGrassWidth = currentGrassWidth * (NUM_LANES - 1)
            const currentTotalRoadWidth = currentRoadWidth * NUM_LANES
            const currentTotalWidth = currentTotalRoadWidth + currentTotalGrassWidth
            const currentStartX = (currentGameWidth - currentTotalWidth) / 2
            const getCurrentLaneCenterX = (laneIndex) => currentStartX + (laneIndex * (currentRoadWidth + currentGrassWidth)) + (currentRoadWidth / 2)

            // 차도 이동 (부드러운 애니메이션)
            // 목표: 캐릭터 몸의 중앙이 목표 차도 중앙과 일치할 때까지
            const targetLaneCenterX = getCurrentLaneCenterX(targetLaneRef.current) // 목표 차도 중앙 위치
            const currentX = currentLaneXRef.current
            const charCenterX = currentX + currentCharacterWidth / 2 // 캐릭터 몸의 중앙 위치
            const diff = targetLaneCenterX - charCenterX // 목표 차도 중앙과 캐릭터 중앙의 차이
            const absDiff = Math.abs(diff)

            if (absDiff > 0.5) {
                // 아직 목표 차도에 도착하지 않음
                setIsArrived(false)

                // 부드럽게 이동 중
                const moveAmount = Math.sign(diff) * Math.min(absDiff, currentLaneChangeSpeed)
                currentLaneXRef.current = currentX + moveAmount
                setCurrentLaneX(currentLaneXRef.current)

                // 목표 차도에 도착할 때까지 L/R 상태 유지 (중간 차도 통과 시에도 유지)
                if (movingDirectionRef.current && characterDirection !== movingDirectionRef.current) {
                    setCharacterDirection(movingDirectionRef.current)
                }
            } else {
                // 목표 차도에 도착함
                setIsArrived(true)

                // 캐릭터 몸의 중앙이 목표 차도 중앙과 일치
                const targetLaneX = targetLaneCenterX - currentCharacterWidth / 2
                currentLaneXRef.current = targetLaneX
                setCurrentLaneX(targetLaneX)

                // 목표 차도에 도착해도 L/R 방향 유지 (M 사용 안함)
                // movingDirectionRef.current는 유지하여 현재 방향 유지
            }

            // 아이템 생성 (2초마다 랜덤하게)
            const WATER_SPAWN_INTERVAL_MS = 2000 // 2초 (2000ms)
            const currentTime = Date.now()

            // 2초가 지났으면 B, Water, F 중에서 2개씩 랜덤 생성
            if (currentTime - lastWaterSpawnTimeRef.current >= WATER_SPAWN_INTERVAL_MS) {
                const spawnY = waterSpawnYRef.current <= 0 ? -currentWaterHeight : waterSpawnYRef.current

                // B, Water, F 중에서 랜덤하게 2개 선택
                const itemTypes = ['water', 'b', 'flower']
                const selectedTypes = []
                const availableTypes = [...itemTypes]

                while (selectedTypes.length < 2) {
                    const randomIndex = Math.floor(Math.random() * availableTypes.length)
                    const selectedType = availableTypes.splice(randomIndex, 1)[0]
                    selectedTypes.push(selectedType)
                }

                // 3개 차도 중에서 랜덤하게 2개 선택
                const lanes = [0, 1, 2]
                const selectedLanes = []
                while (selectedLanes.length < 2) {
                    const randomIndex = Math.floor(Math.random() * lanes.length)
                    const selectedLane = lanes.splice(randomIndex, 1)[0]
                    selectedLanes.push(selectedLane)
                }

                // 선택된 2개 차도에 선택된 2개 아이템 생성
                selectedLanes.forEach((lane, index) => {
                    const itemType = selectedTypes[index]
                    const laneCenterX = getCurrentLaneCenterX(lane)
                    const newItem = {
                        id: Date.now() + Math.random() + index * 1000,
                        type: itemType,
                        x: laneCenterX - currentWaterWidth / 2 + (Math.random() - 0.5) * (currentRoadWidth - currentWaterWidth) * 0.8,
                        y: spawnY - (index * currentWaterHeight * 0.5), // 약간씩 간격을 두고 배치
                        lane: lane
                    }
                    watersRef.current.push(newItem)
                })

                // 다음 생성 위치 업데이트 (일정 간격을 두고)
                waterSpawnYRef.current = spawnY - currentWaterHeight * 2
                lastWaterSpawnTimeRef.current = currentTime
                setWaters([...watersRef.current])
            }

            // 아이템 떨어뜨리기 (B, Water, F)
            const charTop = currentGameHeight - currentCharacterHeight // 캐릭터 상단 위치 (bottom: 0이므로)
            const charBottom = currentGameHeight // 캐릭터 하단 위치 (화면 하단)
            // 충돌 감지 기준선: 캐릭터의 중간 지점보다 더 아래로 내려와야 충돌 (더 늦게 감지)
            const collisionThreshold = currentGameHeight - (currentCharacterHeight * 0.3) // 캐릭터 하단에서 30% 위 지점
            const charLeft = currentLaneXRef.current
            const charRight = currentLaneXRef.current + currentCharacterWidth

            watersRef.current = watersRef.current
                .map(item => ({
                    ...item,
                    y: item.y + currentWaterFallSpeed
                }))
                .filter(item => {
                    // 화면 밖으로 나간 아이템 처리
                    if (item.y > currentGameHeight) {
                        // 화면 밖으로 나갔는데 충돌하지 않았으면 B와 Water는 점수 +10 추가 (F는 충돌해야 점수)
                        if (item.type === 'water' || item.type === 'b') {
                            scoreRef.current += SCORE_PER_WATER
                            setScore(scoreRef.current)
                        }
                        return false
                    }

                    // 실제 충돌 감지 (아이템과 캐릭터가 정확히 겹치는지 확인)
                    const itemTop = item.y
                    const itemBottom = item.y + currentWaterHeight
                    const itemLeft = item.x
                    const itemRight = item.x + currentWaterWidth

                    // 아이템과 캐릭터가 가로로 겹치는지 확인
                    const isHorizontalOverlapping = !(
                        itemRight <= charLeft || // 아이템 오른쪽이 캐릭터 왼쪽보다 왼쪽 또는 같음
                        itemLeft >= charRight    // 아이템 왼쪽이 캐릭터 오른쪽보다 오른쪽 또는 같음
                    )

                    // 아이템이 충돌 기준선보다 더 아래로 내려왔는지 확인 (더 늦게 충돌 감지)
                    const isPastCollisionThreshold = itemBottom >= collisionThreshold

                    // 충돌 감지 (아이템과 캐릭터가 가로로 겹치고, 충돌 기준선을 넘었을 때만)
                    if (isHorizontalOverlapping && isPastCollisionThreshold) {
                        if (item.type === 'water' || item.type === 'b') {
                            // Water 또는 B 충돌 - 생명 감소
                            livesRef.current -= 1
                            setLives(livesRef.current)

                            if (livesRef.current <= 0) {
                                clearInterval(gameLoopRef.current)
                                onGameOver(scoreRef.current)
                            }
                        } else if (item.type === 'flower') {
                            // F 충돌 - 생명은 줄지 않고 +30점
                            scoreRef.current += 30
                            setScore(scoreRef.current)
                        }

                        // 충돌한 아이템은 즉시 제거 (중복 충돌 방지)
                        return false
                    }

                    return true
                })

            setWaters([...watersRef.current])
        }, 16) // 약 60fps

        return () => {
            if (gameLoopRef.current) {
                clearInterval(gameLoopRef.current)
            }
        }
    }, [onGameOver, windowSize])

    // 차도와 풀 배치 계산
    const { grassWidth, startX, getLaneX } = laneCalculations

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
            {/* 차도와 풀 배치 */}
            {Array.from({ length: NUM_LANES }).map((_, laneIndex) => {
                const laneX = getLaneX(laneIndex)

                return (
                    <div key={`lane-${laneIndex}`}>
                        {/* 차도 (연한 회색 배경) */}
                        <div
                            style={{
                                position: 'absolute',
                                left: laneX,
                                top: 0,
                                width: ROAD_WIDTH,
                                height: GAME_HEIGHT,
                                backgroundColor: '#B0B0B0',  // 연한 회색 도로
                                borderLeft: laneIndex === 0 ? '2px solid #fff' : 'none',
                                borderRight: '2px solid #fff'
                            }}
                        >
                            {/* 차도 중간 점선 */}
                            <div
                                style={{
                                    position: 'absolute',
                                    left: ROAD_WIDTH / 2 - 1, // 중앙 위치 (선 두께 2px)
                                    top: 0,
                                    width: 2,
                                    height: GAME_HEIGHT,
                                    backgroundImage: 'repeating-linear-gradient(to bottom, #fff 0px, #fff 20px, transparent 20px, transparent 40px)',
                                    backgroundSize: '2px 40px'
                                }}
                            />
                        </div>

                        {/* 차도 사이 풀 (마지막 차도 다음에는 풀 없음) */}
                        {laneIndex < NUM_LANES - 1 && (
                            <div
                                style={{
                                    position: 'absolute',
                                    left: laneX + ROAD_WIDTH,
                                    top: 0,
                                    width: grassWidth,
                                    height: GAME_HEIGHT,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    flexWrap: 'wrap',
                                    gap: 0,
                                    backgroundColor: '#90EE90'  // 밝은 녹색 배경 (풀 이미지가 투명도가 있을 경우)
                                }}
                            >
                                {/* 풀 타일을 세로로 반복 배치 */}
                                {Array.from({ length: Math.ceil(GAME_HEIGHT / grassWidth) }).map((_, i) => (
                                    <img
                                        key={`grass-${laneIndex}-${i}`}
                                        src={Grass}
                                        alt="grass"
                                        style={{
                                            width: grassWidth,
                                            height: grassWidth,
                                            imageRendering: 'pixelated',
                                            display: 'block'
                                        }}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )
            })}

            {/* 아이템 (B, Water, F) */}
            {waters.map(item => (
                <img
                    key={item.id}
                    src={
                        item.type === 'flower' ? F :
                            item.type === 'b' ? B : Water
                    }
                    alt={item.type === 'flower' ? 'flower' : item.type === 'b' ? 'b' : 'water'}
                    style={{
                        position: 'absolute',
                        left: item.x,
                        top: item.y,
                        width: WATER_WIDTH,
                        height: WATER_HEIGHT,
                        imageRendering: 'pixelated'
                    }}
                />
            ))}

            {/* 캐릭터 - 화면 하단에 위치 */}
            <img
                ref={characterImageRef}
                src={characterDirection === 'L' ? L : R}
                alt="character"
                style={{
                    position: 'absolute',
                    left: currentLaneX,
                    bottom: 0,  // 화면 하단에 위치
                    width: ROAD_WIDTH,
                    height: 'auto',
                    imageRendering: 'pixelated',
                    objectFit: 'contain',
                    objectPosition: 'bottom'
                }}
            />

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
                    textShadow: '2px 2px 4px rgba(0,0,0,0.5)'
                }}
            >
                Score: {score}
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
                        if (serialReaderRef?.current) {
                            await stopSerialReadLoop(serialReaderRef, shouldStopRef)
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