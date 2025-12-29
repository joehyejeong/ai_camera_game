import React, { useState, useEffect, useRef } from 'react'
import { getTopScores, saveScore } from '../../utils/scoreManager'

function Score({ score, onRestart, onBackToHome, readerRef, shouldStopRef }) {
    const [topScores, setTopScores] = useState([])
    const hasSavedRef = useRef(false) // 중복 저장 방지

    // 점수 저장 및 Top 5 로드 (한 번만 실행)
    useEffect(() => {
        if (hasSavedRef.current) return // 이미 저장했으면 스킵
        
        const saveAndLoadScores = async () => {
            hasSavedRef.current = true // 저장 플래그 설정
            // 점수 저장
            await saveScore(score, 'score_3')
            // Top 5 로드
            const result = await getTopScores('score_3')
            if (result.success) {
                setTopScores(result.topScores || [])
            }
        }
        saveAndLoadScores()
    }, [score])
    const handleRestart = async () => {
        console.log('다시 게임하기 - 시리얼 리더 정리 시작')

        // 중단 신호 설정
        if (shouldStopRef) {
            shouldStopRef.current = true
        }

        // 기존 리더 정리
        if (readerRef?.current) {
            try {
                await readerRef.current.cancel()
                readerRef.current.releaseLock()
                readerRef.current = null
                console.log('시리얼 리더 정리 완료')
            } catch (e) {
                console.warn('리더 정리 실패:', e)
            }
        }

        // 약간의 지연 후 재시작 (포트가 완전히 해제되도록)
        setTimeout(() => {
            if (shouldStopRef) {
                shouldStopRef.current = false
            }
            onRestart()
        }, 200)
    }

    const handleBackToHome = async () => {
        console.log('홈으로 - 시리얼 리더 정리 시작')

        // 중단 신호 설정
        if (shouldStopRef) {
            shouldStopRef.current = true
        }

        // 기존 리더 정리
        if (readerRef?.current) {
            try {
                await readerRef.current.cancel()
                readerRef.current.releaseLock()
                readerRef.current = null
                console.log('시리얼 리더 정리 완료')
            } catch (e) {
                console.warn('리더 정리 실패:', e)
            }
        }

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
                console.log('시리얼 포트 닫기 완료')
            } catch (e) {
                console.warn('포트 닫기 실패:', e)
            }
            window.serialPort = null
        }

        // 약간의 지연 후 홈으로 이동
        setTimeout(() => {
            if (shouldStopRef) {
                shouldStopRef.current = false
            }
            onBackToHome()
        }, 200)
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
                gap: '30px',
                color: '#fff',
                fontFamily: 'Arial, sans-serif'
            }}
        >
            <h1
                style={{
                    fontSize: '48px',
                    margin: 0,
                    textShadow: '2px 2px 4px rgba(255,255,255,0.3)'
                }}
            >
                Game Over
            </h1>

            <div
                style={{
                    fontSize: '36px',
                    margin: '20px 0'
                }}
            >
                내 점수: {score}점
            </div>

            {/* Top 5 점수 표시 */}
            <div
                style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    borderRadius: '10px',
                    padding: '20px',
                    minWidth: '300px',
                    maxWidth: '500px',
                    margin: '20px 0'
                }}
            >
                <h2
                    style={{
                        fontSize: '28px',
                        margin: '0 0 20px 0',
                        textAlign: 'center'
                    }}
                >
                    Top 5 점수
                </h2>
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px'
                    }}
                >
                    {topScores.length > 0 ? (
                        topScores.map((item, index) => (
                            <div
                                key={item.id}
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '12px 16px',
                                    backgroundColor: item.score_3 === score ? 'rgba(33, 150, 243, 0.3)' : 'rgba(0, 0, 0, 0.2)',
                                    borderRadius: '8px',
                                    fontSize: '20px',
                                    border: item.score_3 === score ? '2px solid #2196F3' : 'none'
                                }}
                            >
                                <span>{index + 1}위</span>
                                <span style={{ fontWeight: 'bold' }}>{item.score_3}점</span>
                            </div>
                        ))
                    ) : (
                        <div
                            style={{
                                textAlign: 'center',
                                color: '#999',
                                fontSize: '18px',
                                padding: '20px'
                            }}
                        >
                            기록이 없습니다
                        </div>
                    )}
                </div>
            </div>

            <div
                style={{
                    display: 'flex',
                    gap: '20px'
                }}
            >
                <button
                    onClick={handleRestart}
                    style={{
                        padding: '15px 30px',
                        fontSize: '20px',
                        backgroundColor: '#4CAF50',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '5px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
                        transition: 'background-color 0.3s'
                    }}
                    onMouseOver={(e) => e.target.style.backgroundColor = '#45a049'}
                    onMouseOut={(e) => e.target.style.backgroundColor = '#4CAF50'}
                >
                    다시 게임하기
                </button>

                <button
                    onClick={handleBackToHome}
                    style={{
                        padding: '15px 30px',
                        fontSize: '20px',
                        backgroundColor: '#2196F3',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '5px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
                        transition: 'background-color 0.3s'
                    }}
                    onMouseOver={(e) => e.target.style.backgroundColor = '#0b7dda'}
                    onMouseOut={(e) => e.target.style.backgroundColor = '#2196F3'}
                >
                    홈으로
                </button>
            </div>
        </div>
    )
}

export default Score