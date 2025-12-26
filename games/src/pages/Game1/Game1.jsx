import { useState, useEffect, useRef, useCallback } from 'react'
import BImage from '../../assets/game1/B.png'
import WImage from '../../assets/game1/W.png'
import BW_DImage from '../../assets/game1/BW_D.png'
import BW_UImage from '../../assets/game1/BW_U.png'
import W_BImage from '../../assets/game1/W_B.png'
import W_WImage from '../../assets/game1/W_W.png'
import W_BW_DImage from '../../assets/game1/W_BW_D.png'
import W_BW_UImage from '../../assets/game1/W_BW_U.png'
import OImage from '../../assets/game1/O.png'
import XImage from '../../assets/game1/X.png'
import OMusic from '../../assets/game1/music/O.mp3'
import NMusic from '../../assets/game1/music/N.mp3'
import FMusic from '../../assets/game1/music/F.mp3'
import WMusic from '../../assets/game1/music/W.mp3'

// 시리얼 통신 프로토콜 상수 및 클래스 (pre_code.jsx에서 가져옴)
const HEXGL_MESSAGE_HEAD_CODE = 0xFD
const HEXGL_MESSAGE_END_CODE = 0xED

const HexglMessageCommand = {
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

class HexglAiCamProtocol {
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

// 지시문구 상수 배열
const ALL_COMMANDS = [
    '청기 올려',
    '백기 올려',
    '청기 내려',
    '백기 내려',
    '청기 올리지 마',
    '백기 올리지 마',
    '청기 내리지 마',
    '백기 내리지 마'
]

const BOX_TIME = 2000 // 위 박스당 2초 (명령어 있을 때)
const BOX_TIME_EMPTY = 500 // 위 박스당 0.5초 ('-'일 때)
const BOTTOM_BOX_TIME = 2000 // 아래 박스당 2초 (명령어 있을 때)
const BOTTOM_BOX_TIME_EMPTY = 500 // 아래 박스당 0.5초 ('-'일 때)
const ID_CHECK_INTERVAL = 100 // 0.1초마다 ID 체크
const ID_COUNT = 20 // 2초 동안 수집할 ID 개수

function Game1({ onBackToHome }) {
    // 시리얼 포트 관련 상태
    const [port1, setPort1] = useState(null)
    const [id1, setId1] = useState(null) // 현재 받은 ID (표시용)
    const [connected1, setConnected1] = useState(false)
    const [connecting1, setConnecting1] = useState(false)

    // 청기백기 게임 관련 상태
    const [correct, setCorrect] = useState(new Set()) // 초기값: {} (빈 Set)
    const [answer, setAnswer] = useState(null) // 정답 ID 값
    const [lastCorrectAnswer, setLastCorrectAnswer] = useState(2) // 마지막 정답 ID (초기값: 2 = BW_D)
    const [wrongAnswerId, setWrongAnswerId] = useState(null) // 오답 ID (게임 종료 화면 표시용)

    // 게임 진행 상태
    const [gameState, setGameState] = useState('waiting') // 'waiting' | 'playing' | 'finished'
    const [currentQuestion, setCurrentQuestion] = useState(1) // 현재 문제 번호
    const [score, setScore] = useState(0) // 점수
    const [boxIndex, setBoxIndex] = useState(0) // 현재 활성 박스 인덱스 (0-7, 위 0-3, 아래 4-7)
    const [isTopRow, setIsTopRow] = useState(true) // 위 줄인지 아래 줄인지
    const [boxCommands, setBoxCommands] = useState([]) // 각 박스에 표시할 명령어 배열 (8개)
    const [boxResults, setBoxResults] = useState([]) // 각 박스의 결과 (null, true, false)
    const [currentBoxIdList, setCurrentBoxIdList] = useState([]) // 현재 박스에서 수집한 ID 리스트
    const [isCollecting, setIsCollecting] = useState(false) // ID 수집 중인지
    const [revealedTopBoxes, setRevealedTopBoxes] = useState(new Set()) // 공개된 위 박스 인덱스 Set
    const [showDebugModal, setShowDebugModal] = useState(false) // 디버그 모달 표시 여부
    const [showResultImage, setShowResultImage] = useState(null) // 'O' | 'X' | null

    const reader1Ref = useRef(null)
    const protocol1Ref = useRef(new HexglAiCamProtocol())
    const gameTimerRef = useRef(null)
    const timeIntervalRef = useRef(null)
    const id1Ref = useRef(null) // id1의 최신 값을 저장하는 ref
    const boxCommandsRef = useRef([]) // boxCommands의 최신 값을 저장하는 ref
    const correctRef = useRef(new Set()) // correct의 최신 값을 저장하는 ref
    const boxTimerRef = useRef(null) // 박스 타이머
    const idCollectIntervalRef = useRef(null) // ID 수집 interval
    const currentBoxIdListRef = useRef([]) // 현재 박스 ID 리스트 ref
    const processTopBoxRef = useRef(null) // processTopBox 함수 ref
    const processBottomBoxRef = useRef(null) // processBottomBox 함수 ref
    const handleAllBoxesCompleteRef = useRef(null) // handleAllBoxesComplete 함수 ref
    const currentAudioRef = useRef(null) // 현재 재생 중인 오디오 ref
    const isStartingRef = useRef(false) // 박스 시퀀스 시작 중인지 체크 (중복 방지)

    // 음악 재생 함수 (duration 초 재생 후 정지)
    const playMusic = useCallback((musicSrc, duration = 2000) => {
        // 이전 오디오 정지
        if (currentAudioRef.current) {
            currentAudioRef.current.pause()
            currentAudioRef.current.currentTime = 0
            currentAudioRef.current = null
        }

        const audio = new Audio(musicSrc)
        currentAudioRef.current = audio

        // 오디오가 로드된 후 재생하여 끊김 방지
        audio.addEventListener('canplaythrough', () => {
            audio.play().catch(err => {
                console.error('음악 재생 실패:', err)
            })
        }, { once: true })

        // 로드가 이미 완료된 경우 즉시 재생
        if (audio.readyState >= 3) {
            audio.play().catch(err => {
                console.error('음악 재생 실패:', err)
            })
        }

        // duration 후 정지
        setTimeout(() => {
            audio.pause()
            audio.currentTime = 0
            if (currentAudioRef.current === audio) {
                currentAudioRef.current = null
            }
        }, duration)
    }, [])

    // correct를 ID로 변환하는 함수
    const correctToId = (correctSet) => {
        const size = correctSet.size
        if (size === 0) return 2 // {} -> id2
        if (size === 1) {
            if (correctSet.has('a')) return 0 // {a} -> id0
            if (correctSet.has('b')) return 1 // {b} -> id1
        }
        if (size === 2 && correctSet.has('a') && correctSet.has('b')) {
            return 3 // {a,b} -> id3
        }
        return null
    }

    // 지시문구로 correct 업데이트
    const updateCorrectFromCommand = (command) => {
        setCorrect(prev => {
            const newCorrect = new Set(prev)

            switch (command) {
                case '청기 올려':
                    newCorrect.add('a') // add(a)
                    break
                case '백기 올려':
                    newCorrect.add('b') // add(b)
                    break
                case '청기 내려':
                    newCorrect.delete('a') // remove(a)
                    break
                case '백기 내려':
                    newCorrect.delete('b') // remove(b)
                    break
                case '청기 올리지 마':
                    newCorrect.delete('a') // remove(a)
                    break
                case '백기 올리지 마':
                    newCorrect.delete('b') // remove(b)
                    break
                case '청기 내리지 마':
                    newCorrect.add('a') // add(a)
                    break
                case '백기 내리지 마':
                    newCorrect.add('b') // add(b)
                    break
                default:
                    break
            }

            return newCorrect
        })
    }

    // 박스에 표시할 명령어 생성 (위 박스 0-3에만 랜덤 위치에 2-3개)
    const generateBoxCommands = () => {
        const commands = new Array(8).fill(null) // 8개 박스 모두 null로 초기화
        const numCommands = Math.floor(Math.random() * 2) + 2 // 2-3개
        const usedIndices = new Set()

        for (let i = 0; i < numCommands; i++) {
            let randomIndex
            do {
                randomIndex = Math.floor(Math.random() * 4) // 0-3 (위 박스만)
            } while (usedIndices.has(randomIndex))
            usedIndices.add(randomIndex)

            const randomCommand = ALL_COMMANDS[Math.floor(Math.random() * ALL_COMMANDS.length)]
            commands[randomIndex] = randomCommand
        }

        return commands
    }

    // 10개 ID 중 가장 많은 값 찾기 (최빈수가 같으면 가장 최신 값 선택)
    const getMostFrequentId = (idList) => {
        if (idList.length === 0) return null

        const count = {}
        const lastIndex = {} // 각 ID의 마지막 인덱스 저장

        // 한 번의 순회로 빈도와 마지막 인덱스 모두 기록
        idList.forEach((id, index) => {
            count[id] = (count[id] || 0) + 1
            lastIndex[id] = index // 마지막 인덱스 업데이트
        })

        // 최빈수 찾기
        let maxCount = 0
        const mostFrequentIds = []
        Object.keys(count).forEach(id => {
            const idNum = parseInt(id)
            if (count[id] > maxCount) {
                maxCount = count[id]
                mostFrequentIds.length = 0
                mostFrequentIds.push(idNum)
            } else if (count[id] === maxCount) {
                mostFrequentIds.push(idNum)
            }
        })

        // 최빈수가 하나면 바로 반환
        if (mostFrequentIds.length === 1) {
            return mostFrequentIds[0]
        }

        // 최빈수가 여러 개인 경우, 마지막 인덱스가 가장 큰(가장 최신) ID 선택
        let mostRecentId = mostFrequentIds[0]
        let mostRecentIndex = lastIndex[mostRecentId] || -1

        for (let i = 1; i < mostFrequentIds.length; i++) {
            const currentId = mostFrequentIds[i]
            const currentIndex = lastIndex[currentId] || -1
            if (currentIndex > mostRecentIndex) {
                mostRecentId = currentId
                mostRecentIndex = currentIndex
            }
        }

        return mostRecentId
    }

    // 게임 시작
    const startGame = () => {
        setScore(0)
        setCurrentQuestion(1)
        setGameState('playing')
        const newCorrect = new Set()
        setCorrect(newCorrect)
        correctRef.current = newCorrect
        setLastCorrectAnswer(2) // 게임 시작 시 초기 이미지 (BW_D)
        setBoxIndex(0)
        setIsTopRow(true)
        setBoxResults(new Array(8).fill(null))
        setRevealedTopBoxes(new Set()) // 공개된 박스 초기화
        setShowResultImage(null) // 결과 이미지 초기화

        // 박스 명령어 생성
        const commands = generateBoxCommands()
        setBoxCommands(commands)
        boxCommandsRef.current = commands

        // useEffect에서 자동으로 시작됨
    }

    // 박스 시퀀스 시작 (위 박스 0부터 시작)
    const startBoxSequence = () => {
        // ref가 설정되지 않았으면 직접 호출
        if (processTopBoxRef.current) {
            processTopBoxRef.current(0) // 위 박스 0부터 시작
        } else {
            // ref가 아직 설정되지 않았으면 직접 호출 (초기 실행 시)
            processTopBox(0)
        }
    }

    // 위 박스 처리 (명령어 표시) - 모든 위 박스를 먼저 순서대로 표시
    const processTopBox = useCallback((topIndex) => {
        console.log('processTopBox 호출:', topIndex)

        // 시작 플래그 해제 (첫 박스일 때만)
        if (topIndex === 0) {
            isStartingRef.current = false
        }

        if (topIndex >= 4) {
            // 모든 위 박스 표시 완료 - 아래 박스 처리 시작
            console.log('모든 위 박스 표시 완료, 아래 박스 처리 시작')
            if (processBottomBoxRef.current) {
                // 아래 박스 4부터 시작 (위 박스 0에 대응)
                const command = boxCommandsRef.current[0]
                let expectedAnswer = null

                if (command) {
                    const tempCorrect = new Set(correctRef.current)
                    switch (command) {
                        case '청기 올려': tempCorrect.add('a'); break
                        case '백기 올려': tempCorrect.add('b'); break
                        case '청기 내려': tempCorrect.delete('a'); break
                        case '백기 내려': tempCorrect.delete('b'); break
                        case '청기 올리지 마': tempCorrect.delete('a'); break
                        case '백기 올리지 마': tempCorrect.delete('b'); break
                        case '청기 내리지 마': tempCorrect.add('a'); break
                        case '백기 내리지 마': tempCorrect.add('b'); break
                    }
                    expectedAnswer = correctToId(tempCorrect)
                }

                processBottomBoxRef.current(0, 4, expectedAnswer)
            }
            return
        }

        // 이전 타이머 정리
        if (boxTimerRef.current) {
            clearTimeout(boxTimerRef.current)
            boxTimerRef.current = null
        }

        // 위 박스 활성화 (호버 효과)
        setBoxIndex(topIndex)
        setIsTopRow(true)
        // 현재 박스를 공개된 박스에 추가
        setRevealedTopBoxes(prev => {
            const newSet = new Set(prev)
            newSet.add(topIndex)
            return newSet
        })
        console.log('위 박스 활성화:', topIndex)

        // 음악 재생: 명령어가 없으면 N (0.5초), 있으면 F (2초)
        const command = boxCommandsRef.current[topIndex]
        const boxTime = !command ? BOX_TIME_EMPTY : BOX_TIME
        if (!command) {
            playMusic(NMusic, BOX_TIME_EMPTY)
        } else {
            playMusic(FMusic, BOX_TIME)
        }

        // 위 박스 표시 (명령어 없으면 0.5초, 있으면 2초)
        boxTimerRef.current = setTimeout(() => {
            console.log('위 박스 타이머 완료, 다음 위 박스로 이동:', topIndex + 1)
            // 다음 위 박스로 이동
            if (processTopBoxRef.current) {
                processTopBoxRef.current(topIndex + 1)
            }
        }, boxTime)
    }, [playMusic])

    // 아래 박스 처리 (ID 수집 및 정답 체크)
    const processBottomBox = useCallback((topIndex, bottomIndex, expectedAnswer) => {
        console.log('processBottomBox 호출:', { topIndex, bottomIndex, expectedAnswer })

        // 다음 아래 박스로 이동하는 함수
        const moveToNextBottomBox = (currentTopIndex) => {
            const nextTopIndex = currentTopIndex + 1
            console.log('다음 아래 박스로 이동:', nextTopIndex, '->', nextTopIndex + 4)

            if (nextTopIndex >= 4) {
                // 모든 박스 완료
                console.log('모든 박스 완료')
                if (handleAllBoxesCompleteRef.current) {
                    handleAllBoxesCompleteRef.current()
                }
                return
            }

            // 다음 위 박스의 명령어로 예상 정답 계산
            const nextCommand = boxCommandsRef.current[nextTopIndex]
            let nextExpectedAnswer = null

            if (nextCommand) {
                // 현재 correct 상태에서 다음 명령어를 적용한 예상 정답 계산
                const tempCorrect = new Set(correctRef.current)
                switch (nextCommand) {
                    case '청기 올려': tempCorrect.add('a'); break
                    case '백기 올려': tempCorrect.add('b'); break
                    case '청기 내려': tempCorrect.delete('a'); break
                    case '백기 내려': tempCorrect.delete('b'); break
                    case '청기 올리지 마': tempCorrect.delete('a'); break
                    case '백기 올리지 마': tempCorrect.delete('b'); break
                    case '청기 내리지 마': tempCorrect.add('a'); break
                    case '백기 내리지 마': tempCorrect.add('b'); break
                }
                nextExpectedAnswer = correctToId(tempCorrect)
            }

            // 다음 아래 박스 처리
            if (processBottomBoxRef.current) {
                processBottomBoxRef.current(nextTopIndex, nextTopIndex + 4, nextExpectedAnswer)
            }
        }

        // 이전 타이머 및 interval 정리
        if (boxTimerRef.current) {
            clearTimeout(boxTimerRef.current)
            boxTimerRef.current = null
        }
        if (idCollectIntervalRef.current) {
            clearInterval(idCollectIntervalRef.current)
            idCollectIntervalRef.current = null
        }

        // 아래 박스 활성화 (호버 효과)
        setBoxIndex(bottomIndex)
        setIsTopRow(false)
        console.log('아래 박스 활성화:', bottomIndex)

        // 위 박스의 명령어 확인
        const command = boxCommandsRef.current[topIndex]

        // MP3 시작 시점에 리스트 초기화 (다음 MP3가 시작될 때마다 초기화)
        currentBoxIdListRef.current = []
        setCurrentBoxIdList([])
        setIsCollecting(false)

        // 위 박스에 명령어가 없으면 ('-'인 경우): 정답 판단 뛰어넘고 무조건 정답 처리
        if (!command) {
            // 음악 재생: N.mp3 (0.5초) - MP3 시작 시점에 리스트는 이미 초기화됨
            playMusic(NMusic, BOTTOM_BOX_TIME_EMPTY)
            // 체크표시 없이 바로 다음 박스로 이동
            console.log('명령어 없음, 다음 아래 박스로 이동:', topIndex + 1)
            boxTimerRef.current = setTimeout(() => {
                moveToNextBottomBox(topIndex)
            }, BOTTOM_BOX_TIME_EMPTY)
            return
        }

        // 위 박스에 명령어가 있으면: ID 수집하고 정답 체크
        // 음악 재생: F.mp3 (2초) - MP3 시작 시점에 리스트는 이미 초기화됨, 이제 수집 시작
        playMusic(FMusic, BOTTOM_BOX_TIME)
        // ID 수집 시작
        setIsCollecting(true)

        // 0.1초마다 ID 수집 (1초 동안 10개)
        let collectCount = 0
        idCollectIntervalRef.current = setInterval(() => {
            const currentId = id1Ref.current

            // null이거나 255이면 무시
            if (currentId !== null && currentId !== 255 &&
                (currentId === 0 || currentId === 1 || currentId === 2 || currentId === 3)) {
                currentBoxIdListRef.current.push(currentId)
                setCurrentBoxIdList([...currentBoxIdListRef.current])
                collectCount++
            }

            // 10개 수집 완료
            if (collectCount >= ID_COUNT) {
                clearInterval(idCollectIntervalRef.current)
                idCollectIntervalRef.current = null
                setIsCollecting(false)

                // 가장 많은 ID 찾기
                const mostFrequentId = getMostFrequentId(currentBoxIdListRef.current)

                // 정답 체크 (명령어가 있으므로 expectedAnswer는 null이 아님)
                if (expectedAnswer !== null) {
                    const isCorrect = mostFrequentId === expectedAnswer

                    if (!isCorrect) {
                        // 오답 - 음악 재생: W.mp3 (2초)
                        playMusic(WMusic, BOTTOM_BOX_TIME)
                        // 체크표시하고 X 이미지 1초 표시 후 게임 종료
                        setBoxResults(prev => {
                            const newResults = [...prev]
                            newResults[topIndex] = false
                            newResults[bottomIndex] = false
                            return newResults
                        })
                        setWrongAnswerId(mostFrequentId)
                        setShowResultImage('X')
                        setTimeout(() => {
                            setShowResultImage(null)
                            setGameState('finished')
                        }, 1000)
                        return
                    } else {
                        // 정답 - 체크표시 없이 correct 업데이트하고 다음 박스로
                        const newCorrect = new Set(correctRef.current)
                        switch (command) {
                            case '청기 올려': newCorrect.add('a'); break
                            case '백기 올려': newCorrect.add('b'); break
                            case '청기 내려': newCorrect.delete('a'); break
                            case '백기 내려': newCorrect.delete('b'); break
                            case '청기 올리지 마': newCorrect.delete('a'); break
                            case '백기 올리지 마': newCorrect.delete('b'); break
                            case '청기 내리지 마': newCorrect.add('a'); break
                            case '백기 내리지 마': newCorrect.add('b'); break
                        }
                        setCorrect(newCorrect)
                        correctRef.current = newCorrect

                        // 이미지 즉시 업데이트
                        const newAnswer = correctToId(newCorrect)
                        if (newAnswer !== null) {
                            setLastCorrectAnswer(newAnswer)
                        }

                        // 다음 아래 박스로 이동
                        console.log('정답 처리 완료, 다음 아래 박스로 이동:', topIndex + 1)
                        moveToNextBottomBox(topIndex)
                    }
                }
            }
        }, ID_CHECK_INTERVAL)

        // 2초 후 강제 종료 (타임아웃)
        boxTimerRef.current = setTimeout(() => {
            if (idCollectIntervalRef.current) {
                clearInterval(idCollectIntervalRef.current)
                idCollectIntervalRef.current = null
            }
            setIsCollecting(false)

            // 가장 많은 ID 찾기
            const mostFrequentId = getMostFrequentId(currentBoxIdListRef.current)

            // 정답 체크
            if (expectedAnswer !== null) {
                const isCorrect = mostFrequentId === expectedAnswer

                if (!isCorrect) {
                    // 오답 - 음악 재생: W.mp3 (2초)
                    playMusic(WMusic, BOTTOM_BOX_TIME)
                    // 체크표시하고 X 이미지 1초 표시 후 게임 종료
                    setBoxResults(prev => {
                        const newResults = [...prev]
                        newResults[topIndex] = false
                        newResults[bottomIndex] = false
                        return newResults
                    })
                    setWrongAnswerId(mostFrequentId)
                    setShowResultImage('X')
                    setTimeout(() => {
                        setShowResultImage(null)
                        setGameState('finished')
                    }, 1000)
                    return
                } else {
                    // 정답 - 체크표시 없이 correct 업데이트하고 다음 박스로
                    const newCorrect = new Set(correctRef.current)
                    switch (command) {
                        case '청기 올려': newCorrect.add('a'); break
                        case '백기 올려': newCorrect.add('b'); break
                        case '청기 내려': newCorrect.delete('a'); break
                        case '백기 내려': newCorrect.delete('b'); break
                        case '청기 올리지 마': newCorrect.delete('a'); break
                        case '백기 올리지 마': newCorrect.delete('b'); break
                        case '청기 내리지 마': newCorrect.add('a'); break
                        case '백기 내리지 마': newCorrect.add('b'); break
                    }
                    setCorrect(newCorrect)
                    correctRef.current = newCorrect

                    // 이미지 즉시 업데이트
                    const newAnswer = correctToId(newCorrect)
                    if (newAnswer !== null) {
                        setLastCorrectAnswer(newAnswer)
                    }

                    moveToNextBottomBox(topIndex)
                }
            }
        }, BOTTOM_BOX_TIME)
    }, [playMusic])

    // 모든 박스 완료 처리
    const handleAllBoxesComplete = useCallback(() => {
        // 점수 추가
        setScore(prev => prev + 10)

        // 정답 음악 재생: O.mp3 (0.5초) - 문제당 마지막에만 재생
        playMusic(OMusic, 500)

        // O 이미지 1초 표시 후 다음 문제로
        setShowResultImage('O')
        setTimeout(() => {
            setShowResultImage(null)
            setCurrentQuestion(prev => prev + 1)
            const newCorrect = new Set()
            setCorrect(newCorrect)
            correctRef.current = newCorrect
            setBoxIndex(0)
            setIsTopRow(true)
            setBoxResults(new Array(8).fill(null))
            setRevealedTopBoxes(new Set()) // 공개된 박스 초기화

            // 새로운 명령어 생성
            const commands = generateBoxCommands()
            setBoxCommands(commands)
            boxCommandsRef.current = commands

            // useEffect에서 자동으로 시작됨 (직접 호출 제거하여 중복 방지)
        }, 1000)
    }, [playMusic])

    // handleAllBoxesComplete ref 업데이트
    useEffect(() => {
        handleAllBoxesCompleteRef.current = handleAllBoxesComplete
    }, [handleAllBoxesComplete])

    // correct 변경 시 answer 업데이트 및 ref 동기화
    useEffect(() => {
        correctRef.current = correct
        const newAnswer = correctToId(correct)
        setAnswer(newAnswer)
        if (newAnswer !== null) {
            setLastCorrectAnswer(newAnswer)
        }
    }, [correct])

    // boxCommands 변경 시 ref 동기화
    useEffect(() => {
        boxCommandsRef.current = boxCommands
    }, [boxCommands])

    // processTopBox와 processBottomBox ref 업데이트
    useEffect(() => {
        processTopBoxRef.current = processTopBox
    }, [processTopBox])

    useEffect(() => {
        processBottomBoxRef.current = processBottomBox
    }, [processBottomBox])

    // 게임 시작 시 자동으로 박스 시퀀스 시작
    useEffect(() => {
        if (gameState === 'playing' && boxCommands.length > 0 && processTopBoxRef.current && !isStartingRef.current) {
            isStartingRef.current = true
            console.log('게임 시작 - 박스 시퀀스 시작')
            // 약간의 지연을 두어 상태가 완전히 설정되도록
            const timer = setTimeout(() => {
                if (processTopBoxRef.current) {
                    processTopBoxRef.current(0)
                }
                // processTopBox가 시작되면 플래그 해제 (processTopBox 내부에서 처리 완료 후)
                setTimeout(() => {
                    isStartingRef.current = false
                }, 200)
            }, 100)
            return () => {
                clearTimeout(timer)
                isStartingRef.current = false
            }
        }
    }, [gameState, boxCommands, currentQuestion])

    // id1이 변경될 때 id1Ref 업데이트
    useEffect(() => {
        id1Ref.current = id1
    }, [id1])

    // ID 추출 로직
    const extractIds = (msg) => {
        if (!msg || !msg.head) return []

        const ids = []

        if (msg.head.cmd === HexglMessageCommand.CLASSIFICATION) {
            const type = msg.data && msg.data.length > 0 ? msg.data[0] : null
            for (let i = 1; i < msg.head.length; i += 2) {
                const id = msg.data[i]
                const confidence = msg.data[i + 1]
                if (typeof id !== 'undefined') {
                    ids.push({ id, confidence, type: 'classification' })
                }
            }
        } else if (msg.head.cmd === HexglMessageCommand.DETECTION) {
            const dtype = msg.data && msg.data.length > 0 ? msg.data[0] : null
            for (let j = 1; j < msg.head.length; j += 6) {
                if (j + 5 >= msg.head.length) break
                const did = msg.data[j]
                const dconfidence = msg.data[j + 5]
                if (typeof did !== 'undefined') {
                    ids.push({ id: did, confidence: dconfidence, type: 'detection' })
                }
            }
        }

        return ids
    }

    const startReading = async (port) => {
        if (!port || !port.readable) return

        const reader = port.readable.getReader()
        const protocol = protocol1Ref.current
        reader1Ref.current = reader

        try {
            while (true) {
                const result = await reader.read()
                if (result.done) break

                if (result.value) {
                    for (let k = 0; k < result.value.length; k++) {
                        const message = protocol.feedByte(result.value[k])
                        if (message) {
                            const ids = extractIds(message)
                            if (ids.length > 0) {
                                const bestId = ids[0].id
                                // id 255는 무시
                                if (bestId === 255) {
                                    id1Ref.current = null
                                    setId1(null)
                                    console.log('255 감지 - id1 초기화')
                                } else {
                                    id1Ref.current = bestId // ref에 최신 값 저장
                                    setId1(bestId)
                                }
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Port read error:', error)
        } finally {
            try {
                reader.releaseLock()
            } catch (e) {
                // Ignore
            }
            reader1Ref.current = null
            setConnected1(false)
        }
    }

    const connectPort = async () => {
        if (!navigator.serial) {
            alert('Web Serial API가 지원되지 않는 브라우저입니다.')
            return
        }

        if (connecting1 || connected1) return
        setConnecting1(true)

        try {
            const port = await navigator.serial.requestPort()
            await port.open({ baudRate: 9600 })

            if (!port.readable) {
                throw new Error('포트를 읽을 수 없습니다.')
            }

            setPort1(port)
            protocol1Ref.current.reset()
            setConnected1(true)
            setConnecting1(false)
            startReading(port)
        } catch (error) {
            if (error.name === 'NotFoundError') {
                console.log('Port selection cancelled by user')
            } else {
                console.error('Port connection error:', error)
                alert(`포트 연결 실패: ${error.message}`)
            }

            setConnecting1(false)
            setConnected1(false)
        }
    }

    const disconnectPort = async () => {
        if (reader1Ref.current) {
            try {
                await reader1Ref.current.cancel()
                reader1Ref.current.releaseLock()
            } catch (e) {
                // Ignore
            }
            reader1Ref.current = null
        }
        if (port1) {
            try {
                await port1.close()
            } catch (e) {
                // Ignore
            }
            setPort1(null)
        }
        setConnected1(false)
        setId1(null)
        protocol1Ref.current.reset()
    }

    // cleanup
    useEffect(() => {
        return () => {
            if (reader1Ref.current) {
                reader1Ref.current.cancel().catch(() => { })
            }
            if (port1) {
                port1.close().catch(() => { })
            }
            if (boxTimerRef.current) {
                clearTimeout(boxTimerRef.current)
            }
            if (idCollectIntervalRef.current) {
                clearInterval(idCollectIntervalRef.current)
            }
            if (currentAudioRef.current) {
                currentAudioRef.current.pause()
                currentAudioRef.current.currentTime = 0
                currentAudioRef.current = null
            }
        }
    }, [])

    return (
        <>
            <style>{`
        @keyframes scaleIn {
          from {
            transform: scale(0.5);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }
      `}</style>
            <div style={styles.container}>
                {/* 대기 화면 */}
                {gameState === 'waiting' && (
                    <div style={styles.waitingScreen}>
                        <h1 style={styles.mainTitle}>청기백기 게임</h1>
                        <div style={styles.cameraSetup}>
                            <h2 style={styles.subTitle}>카메라 연결</h2>
                            <div style={styles.portsContainer}>
                                <div style={styles.portCard}>
                                    <h3 style={styles.portTitle}>카메라</h3>
                                    <span style={{
                                        ...styles.statusBadge,
                                        ...(connected1 ? styles.connected : styles.disconnected)
                                    }}>
                                        {connected1 ? '연결됨' : connecting1 ? '연결 중...' : '연결 안 됨'}
                                    </span>
                                    <button
                                        style={{
                                            ...styles.button,
                                            ...(connected1 ? styles.disconnectButton : styles.connectButton)
                                        }}
                                        onClick={() => connected1 ? disconnectPort() : connectPort()}
                                        disabled={connecting1}
                                    >
                                        {connected1 ? '연결 해제' : connecting1 ? '연결 중...' : '카메라 연결'}
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center' }}>
                            <button
                                style={styles.startButton}
                                onClick={startGame}
                                disabled={!connected1}
                            >
                                게임 시작
                            </button>
                            {onBackToHome && (
                                <button
                                    style={{
                                        ...styles.startButton,
                                        backgroundColor: '#2196F3'
                                    }}
                                    onClick={async () => {
                                        await disconnectPort()
                                        onBackToHome()
                                    }}
                                >
                                    홈으로
                                </button>
                            )}
                        </div>
                        {!connected1 && (
                            <p style={styles.warningText}>카메라를 연결해주세요</p>
                        )}
                    </div>
                )}

                {/* 게임 플레이 화면 */}
                {gameState === 'playing' && (
                    <div style={styles.gameScreen}>
                        {/* 상단 정보 */}
                        <div style={styles.gameHeader}>
                            <div style={styles.gameInfo}>
                                <div style={styles.infoItem}>문제 {currentQuestion}</div>
                                <div style={styles.infoItem}>점수: {score}점</div>
                            </div>
                            {/* 뒤로가기 버튼 */}
                            <button
                                onClick={() => {
                                    // 게임 루프 정리
                                    if (boxTimerRef.current) {
                                        clearTimeout(boxTimerRef.current)
                                        boxTimerRef.current = null
                                    }
                                    if (idCollectIntervalRef.current) {
                                        clearInterval(idCollectIntervalRef.current)
                                        idCollectIntervalRef.current = null
                                    }
                                    if (currentAudioRef.current) {
                                        currentAudioRef.current.pause()
                                        currentAudioRef.current.currentTime = 0
                                        currentAudioRef.current = null
                                    }
                                    setGameState('waiting')
                                }}
                                style={{
                                    padding: '10px 20px',
                                    fontSize: '16px',
                                    backgroundColor: '#f44336',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold'
                                }}
                            >
                                뒤로가기
                            </button>
                        </div>

                        {/* 위 네모 4개 */}
                        <div style={styles.boxRow}>
                            {[0, 1, 2, 3].map((index) => {
                                const isActive = boxIndex === index && isTopRow
                                const hasCommand = boxCommands[index]
                                // 공개된 박스 Set을 사용하여 정확한 타이밍 보장
                                // 위 박스 처리 중이거나 아래 박스 처리 중일 때 공개된 박스는 계속 표시
                                const isRevealed = revealedTopBoxes.has(index) || (!isTopRow && boxIndex >= 4)

                                return (
                                    <div
                                        key={index}
                                        style={{
                                            ...styles.box,
                                            ...(isActive ? styles.boxActive : {}),
                                            ...(boxResults[index] === true ? styles.boxCorrect : {}),
                                            ...(boxResults[index] === false ? styles.boxWrong : {})
                                        }}
                                    >
                                        <div style={styles.boxContent}>
                                            {/* 명령어가 없으면 '-' 표시 */}
                                            {!hasCommand && (
                                                <div style={styles.boxPlaceholder}>-</div>
                                            )}
                                            {/* 명령어가 있지만 아직 공개되지 않았으면 '?' 표시 */}
                                            {hasCommand && !isRevealed && (
                                                <div style={styles.boxQuestion}>?</div>
                                            )}
                                            {/* 명령어가 있고 공개되었으면 실제 명령어 표시 (계속 표시) */}
                                            {hasCommand && isRevealed && (
                                                <div style={styles.boxCommand}>{boxCommands[index]}</div>
                                            )}
                                            {/* 결과 표시 */}
                                            {boxResults[index] === true && (
                                                <div style={styles.boxResult}>✓</div>
                                            )}
                                            {boxResults[index] === false && (
                                                <div style={styles.boxResultWrong}>✗</div>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>

                        {/* 중앙 캐릭터 */}
                        <div style={styles.characterContainer}>
                            {(() => {
                                let imageSrc = BW_DImage
                                const displayAnswer = lastCorrectAnswer
                                if (displayAnswer === 0) imageSrc = BImage
                                else if (displayAnswer === 1) imageSrc = WImage
                                else if (displayAnswer === 2) imageSrc = BW_DImage
                                else if (displayAnswer === 3) imageSrc = BW_UImage

                                return (
                                    <img
                                        src={imageSrc}
                                        alt="현재 상태"
                                        style={styles.characterImage}
                                    />
                                )
                            })()}
                        </div>

                        {/* O/X 결과 이미지 오버레이 */}
                        {showResultImage && (
                            <div style={styles.resultOverlay}>
                                <img
                                    src={showResultImage === 'O' ? OImage : XImage}
                                    alt={showResultImage === 'O' ? '정답' : '오답'}
                                    style={styles.resultImage}
                                />
                            </div>
                        )}

                        {/* 아래 네모 4개 */}
                        <div style={styles.boxRow}>
                            {[4, 5, 6, 7].map((index) => (
                                <div
                                    key={index}
                                    style={{
                                        ...styles.box,
                                        ...(boxIndex === index && !isTopRow ? styles.boxActive : {}),
                                        ...(boxResults[index] === true ? styles.boxCorrect : {}),
                                        ...(boxResults[index] === false ? styles.boxWrong : {})
                                    }}
                                >
                                    <div style={styles.boxContent}>
                                        {boxResults[index] === true && (
                                            <div style={styles.boxResult}>✓</div>
                                        )}
                                        {boxResults[index] === false && (
                                            <div style={styles.boxResultWrong}>✗</div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 디버그 모달 */}
                {showDebugModal && (
                    <div style={styles.modalOverlay} onClick={() => setShowDebugModal(false)}>
                        <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                            <div style={styles.modalHeader}>
                                <h2 style={styles.modalTitle}>디버그 정보</h2>
                                <button
                                    onClick={() => setShowDebugModal(false)}
                                    style={styles.modalCloseButton}
                                >
                                    ✕
                                </button>
                            </div>
                            <div style={styles.modalBody}>
                                <div style={styles.debugItem}>
                                    <strong>현재 박스:</strong> {boxIndex}
                                </div>
                                <div style={styles.debugItem}>
                                    <strong>위/아래:</strong> {isTopRow ? '위' : '아래'}
                                </div>
                                <div style={styles.debugItem}>
                                    <strong>수집 중:</strong> {isCollecting ? '예' : '아니오'}
                                </div>
                                <div style={styles.debugItem}>
                                    <strong>ID 리스트:</strong> [{currentBoxIdList.join(', ')}]
                                </div>
                                <div style={styles.debugItem}>
                                    <strong>현재 ID:</strong> {id1 !== null ? id1 : '-'}
                                </div>
                                <div style={styles.debugItem}>
                                    <strong>정답 상태 (correct):</strong> {correct.size === 0 ? '{}' : `{${Array.from(correct).join(', ')}}`}
                                </div>
                                <div style={styles.debugItem}>
                                    <strong>예상 정답 (answer):</strong> {answer !== null ? answer : '-'}
                                </div>
                                <div style={styles.debugItem}>
                                    <strong>박스 명령어:</strong>
                                    <div style={styles.debugCommands}>
                                        {boxCommands.map((cmd, idx) => (
                                            <div key={idx} style={styles.debugCommandItem}>
                                                박스 {idx}: {cmd || '-'}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 게임 종료 화면 */}
                {gameState === 'finished' && (
                    <div style={styles.finishedScreen}>
                        <h1 style={styles.mainTitle}>게임 종료</h1>

                        {/* 오답 이미지 표시 */}
                        <div style={styles.wrongAnswerImageContainer}>
                            {(() => {
                                let wrongImageSrc = W_BW_DImage // 기본값
                                const displayId = wrongAnswerId !== null ? wrongAnswerId : 2 // null이면 기본값 2

                                if (displayId === 0) wrongImageSrc = W_BImage
                                else if (displayId === 1) wrongImageSrc = W_WImage
                                else if (displayId === 2) wrongImageSrc = W_BW_DImage
                                else if (displayId === 3) wrongImageSrc = W_BW_UImage

                                console.log('오답 이미지 표시:', { wrongAnswerId, displayId, imageSrc: wrongImageSrc })

                                return (
                                    <img
                                        src={wrongImageSrc}
                                        alt="오답 이미지"
                                        style={styles.wrongAnswerImage}
                                    />
                                )
                            })()}
                        </div>

                        <div style={styles.scoreDisplay}>
                            <div style={styles.scoreLabel}>총 점수</div>
                            <div style={styles.scoreValue}>{score}점</div>
                        </div>
                        <div style={{ display: 'flex', gap: '20px', flexDirection: 'column', alignItems: 'center' }}>
                            <button
                                style={styles.startButton}
                                onClick={() => {
                                    setGameState('waiting')
                                    setScore(0)
                                    setCurrentQuestion(1)
                                    setWrongAnswerId(null)
                                }}
                            >
                                다시 시작
                            </button>
                            {onBackToHome && (
                                <button
                                    style={{
                                        ...styles.startButton,
                                        backgroundColor: '#2196F3'
                                    }}
                                    onClick={async () => {
                                        await disconnectPort()
                                        onBackToHome()
                                    }}
                                >
                                    홈으로
                                </button>
                            )}
                            {/* 디버그 버튼 */}
                            <button
                                onClick={() => setShowDebugModal(true)}
                                style={styles.debugButton}
                            >
                                디버그 정보
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </>
    )
}

const styles = {
    container: {
        width: '100%',
        minHeight: '100vh',
        fontFamily: 'Arial, sans-serif',
        backgroundColor: '#f5f5f5'
    },
    // 대기 화면
    waitingScreen: {
        padding: '40px',
        maxWidth: '800px',
        margin: '0 auto',
        textAlign: 'center'
    },
    mainTitle: {
        fontSize: '48px',
        color: '#333',
        marginBottom: '40px'
    },
    subTitle: {
        fontSize: '24px',
        color: '#666',
        marginBottom: '20px'
    },
    cameraSetup: {
        marginBottom: '40px'
    },
    portsContainer: {
        display: 'flex',
        gap: '20px',
        justifyContent: 'center',
        marginBottom: '40px'
    },
    portCard: {
        padding: '20px',
        border: '2px solid #ddd',
        borderRadius: '12px',
        backgroundColor: 'white',
        minWidth: '200px'
    },
    portTitle: {
        marginTop: 0,
        marginBottom: '15px',
        fontSize: '20px',
        color: '#333'
    },
    statusBadge: {
        display: 'block',
        padding: '8px 16px',
        borderRadius: '20px',
        fontSize: '14px',
        fontWeight: 'bold',
        marginBottom: '15px'
    },
    connected: {
        backgroundColor: '#4CAF50',
        color: 'white'
    },
    disconnected: {
        backgroundColor: '#f44336',
        color: 'white'
    },
    button: {
        width: '100%',
        padding: '12px 24px',
        fontSize: '16px',
        fontWeight: 'bold',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        transition: 'background-color 0.3s'
    },
    connectButton: {
        backgroundColor: '#2196F3',
        color: 'white'
    },
    disconnectButton: {
        backgroundColor: '#f44336',
        color: 'white'
    },
    startButton: {
        padding: '20px 60px',
        fontSize: '24px',
        fontWeight: 'bold',
        backgroundColor: '#4CAF50',
        color: 'white',
        border: 'none',
        borderRadius: '12px',
        cursor: 'pointer',
        transition: 'background-color 0.3s',
        marginTop: '20px'
    },
    warningText: {
        marginTop: '20px',
        color: '#f44336',
        fontSize: '16px'
    },
    // 게임 플레이 화면
    gameScreen: {
        padding: '40px',
        maxWidth: '1200px',
        margin: '0 auto',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxSizing: 'border-box'
    },
    gameHeader: {
        marginBottom: '20px',
        flexShrink: 0
    },
    gameInfo: {
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: '15px',
        fontSize: '20px',
        fontWeight: 'bold',
        color: '#333'
    },
    infoItem: {
        padding: '10px 20px',
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    },
    progressBarContainer: {
        width: '100%',
        height: '30px',
        backgroundColor: '#e0e0e0',
        borderRadius: '15px',
        overflow: 'hidden',
        boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)'
    },
    progressBar: {
        height: '100%',
        transition: 'width 0.1s linear, background-color 0.3s',
        borderRadius: '15px'
    },
    statusImageContainer: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '20px',
        minHeight: '200px'
    },
    statusImage: {
        maxWidth: '300px',
        maxHeight: '300px',
        objectFit: 'contain'
    },
    commandDisplay: {
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '400px'
    },
    countdownText: {
        fontSize: '120px',
        fontWeight: 'bold',
        color: '#f44336',
        textAlign: 'center',
        textShadow: '2px 2px 4px rgba(0,0,0,0.1)',
        animation: 'pulse 0.5s ease-in-out infinite'
    },
    commandText: {
        fontSize: '72px',
        fontWeight: 'bold',
        color: '#2196F3',
        textAlign: 'center',
        textShadow: '2px 2px 4px rgba(0,0,0,0.1)'
    },
    correctDisplay: {
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '400px'
    },
    correctText: {
        fontSize: '64px',
        fontWeight: 'bold',
        color: '#4CAF50',
        textAlign: 'center',
        animation: 'pulse 0.5s ease-in-out'
    },
    cameraDisplay: {
        display: 'flex',
        gap: '40px',
        justifyContent: 'center',
        marginTop: '40px'
    },
    cameraItem: {
        padding: '30px',
        backgroundColor: 'white',
        borderRadius: '12px',
        boxShadow: '0 4px 8px rgba(0,0,0,0.1)',
        textAlign: 'center',
        minWidth: '200px'
    },
    cameraLabel: {
        fontSize: '18px',
        color: '#666',
        marginBottom: '15px',
        fontWeight: 'bold'
    },
    cameraId: {
        fontSize: '48px',
        fontWeight: 'bold',
        color: '#2196F3',
        marginBottom: '15px'
    },
    cameraInfo: {
        marginBottom: '15px'
    },
    cameraInfoLabel: {
        fontSize: '14px',
        color: '#666',
        marginBottom: '5px'
    },
    cameraInfoValue: {
        fontSize: '24px',
        fontWeight: 'bold',
        color: '#333'
    },
    cameraStatus: {
        fontSize: '36px',
        fontWeight: 'bold'
    },
    cameraCorrect: {
        color: '#4CAF50'
    },
    cameraWaiting: {
        color: '#e0e0e0'
    },
    // 게임 종료 화면
    finishedScreen: {
        padding: '40px',
        maxWidth: '600px',
        margin: '0 auto',
        textAlign: 'center',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center'
    },
    scoreDisplay: {
        margin: '60px 0',
        padding: '40px',
        backgroundColor: 'white',
        borderRadius: '20px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
    },
    scoreLabel: {
        fontSize: '32px',
        color: '#666',
        marginBottom: '20px'
    },
    scoreValue: {
        fontSize: '80px',
        fontWeight: 'bold',
        color: '#2196F3'
    },
    wrongAnswerImageContainer: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '30px'
    },
    wrongAnswerImage: {
        maxWidth: '400px',
        maxHeight: '400px',
        objectFit: 'contain'
    },
    // 새 UI 스타일
    boxRow: {
        display: 'flex',
        gap: '20px',
        justifyContent: 'center',
        margin: '15px 0',
        flexShrink: 0
    },
    box: {
        width: '200px',
        height: '150px',
        border: '2px solid #ddd',
        borderRadius: '12px',
        backgroundColor: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.3s ease',
        position: 'relative'
    },
    boxActive: {
        backgroundColor: '#5275C9',
        borderColor: '#5275C9',
        transform: 'scale(1.05)',
        boxShadow: '0 4px 12px rgba(82, 117, 201, 0.4)'
    },
    boxCorrect: {
        borderColor: '#4CAF50',
        backgroundColor: '#e8f5e9'
    },
    boxWrong: {
        borderColor: '#f44336',
        backgroundColor: '#ffebee'
    },
    boxContent: {
        textAlign: 'center',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '10px'
    },
    boxCommand: {
        fontSize: '18px',
        fontWeight: 'bold',
        color: '#333',
        marginBottom: '10px'
    },
    boxPlaceholder: {
        fontSize: '48px',
        fontWeight: 'bold',
        color: '#999'
    },
    boxQuestion: {
        fontSize: '48px',
        fontWeight: 'bold',
        color: '#666'
    },
    boxResult: {
        fontSize: '48px',
        color: '#4CAF50',
        fontWeight: 'bold'
    },
    boxResultWrong: {
        fontSize: '48px',
        color: '#f44336',
        fontWeight: 'bold'
    },
    characterContainer: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '20px 0',
        flex: '1 1 auto',
        minHeight: 0
    },
    characterImage: {
        maxWidth: '300px',
        maxHeight: '300px',
        objectFit: 'contain'
    },
    resultOverlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        pointerEvents: 'none'
    },
    resultImage: {
        width: '80vh',
        height: '80vh',
        maxWidth: '600px',
        maxHeight: '600px',
        objectFit: 'contain',
        animation: 'scaleIn 0.3s ease-out'
    },
    debugButton: {
        marginTop: '10px',
        padding: '6px 12px',
        backgroundColor: '#2196F3',
        color: 'white',
        border: 'none',
        borderRadius: '6px',
        fontSize: '12px',
        cursor: 'pointer',
        fontWeight: 'bold',
        transition: 'background-color 0.3s',
        flexShrink: 0,
        alignSelf: 'center'
    },
    modalOverlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000
    },
    modalContent: {
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '0',
        maxWidth: '600px',
        width: '90%',
        maxHeight: '80vh',
        overflow: 'auto',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)'
    },
    modalHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '20px',
        borderBottom: '1px solid #e0e0e0'
    },
    modalTitle: {
        margin: 0,
        fontSize: '24px',
        fontWeight: 'bold',
        color: '#333'
    },
    modalCloseButton: {
        background: 'none',
        border: 'none',
        fontSize: '28px',
        cursor: 'pointer',
        color: '#666',
        padding: '0',
        width: '30px',
        height: '30px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '4px',
        transition: 'background-color 0.2s'
    },
    modalBody: {
        padding: '20px'
    },
    debugItem: {
        marginBottom: '15px',
        fontSize: '16px',
        color: '#333',
        lineHeight: '1.6'
    },
    debugCommands: {
        marginTop: '10px',
        padding: '10px',
        backgroundColor: '#f5f5f5',
        borderRadius: '6px'
    },
    debugCommandItem: {
        padding: '5px 0',
        fontSize: '14px',
        color: '#666'
    }
}

export default Game1

