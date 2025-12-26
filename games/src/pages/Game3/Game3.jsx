import { useState, useRef } from 'react'
import Lending from './Lending'
import Play from './Play'
import Score from './Score'

function Game3({ onBackToHome: appBackToHome }) {
    const [currentPage, setCurrentPage] = useState('lending')
    const [finalScore, setFinalScore] = useState(0)

    // 시리얼 리더 관련 ref들 - 전역으로 관리
    const serialReaderRef = useRef(null)
    const shouldStopRef = useRef(false)

    const handleStartGame = () => {
        setCurrentPage('play')
    }

    const handleGameOver = (score) => {
        setFinalScore(score)
        setCurrentPage('score')
    }

    const handleRestart = () => {
        setCurrentPage('play')
    }

    const handleBackToHome = () => {
        if (appBackToHome) {
            appBackToHome()
        } else {
            setCurrentPage('lending')
        }
    }

    return (
        <>
            {currentPage === 'lending' && <Lending onStart={handleStartGame} onBackToHome={appBackToHome} />}
            {currentPage === 'play' && (
                <Play
                    onGameOver={handleGameOver}
                    serialReaderRef={serialReaderRef}
                    shouldStopRef={shouldStopRef}
                    onBack={() => setCurrentPage('lending')}
                />
            )}
            {currentPage === 'score' && (
                <Score
                    score={finalScore}
                    onRestart={handleRestart}
                    onBackToHome={handleBackToHome}
                    readerRef={serialReaderRef}
                    shouldStopRef={shouldStopRef}
                />
            )}
        </>
    )
}

export default Game3