import { useState } from 'react'
import Lending from './pages/Lending/Lending'
import Game1 from './pages/Game1/Game1'
import Game2 from './pages/Game2/Game2'
import Game3 from './pages/Game3/Game3'

function App() {
  const [currentPage, setCurrentPage] = useState('lending')

  const handleGameSelect = (gameId) => {
    if (gameId === 1) {
      setCurrentPage('game1')
    } else if (gameId === 2) {
      setCurrentPage('game2')
    } else if (gameId === 3) {
      setCurrentPage('game3')
    }
  }

  const handleBackToLending = () => {
    setCurrentPage('lending')
  }

  return (
    <>
      {currentPage === 'lending' && <Lending onGameSelect={handleGameSelect} />}
      {currentPage === 'game1' && <Game1 onBackToHome={handleBackToLending} />}
      {currentPage === 'game2' && <Game2 onBackToHome={handleBackToLending} />}
      {currentPage === 'game3' && <Game3 onBackToHome={handleBackToLending} />}
    </>
  )
}

export default App
