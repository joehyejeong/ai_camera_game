import { useState } from 'react'
import game1 from '../../assets/game1.png'
import game2 from '../../assets/game2.png'
import game3 from '../../assets/game3.png'

function Lending({ onGameSelect }) {
    const games = [
        { id: 1, name: '박자 게임', image: game1 },
        { id: 2, name: '똥피하기게임', image: game2 },
        { id: 3, name: '자동차 게임', image: game3 }
    ]

    const handleGameClick = (gameId) => {
        if (onGameSelect) {
            onGameSelect(gameId)
        }
    }

    return (
        <div style={{
            minHeight: '100vh',
            backgroundColor: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px 20px',
            fontFamily: 'Arial, sans-serif'
        }}>
            <h1 style={{
                fontSize: '2.5rem',
                fontWeight: 'bold',
                color: '#000000',
                marginBottom: '60px',
                textAlign: 'center'
            }}>
                원하는 게임을 선택하세요
            </h1>

            <div style={{
                display: 'flex',
                gap: '40px',
                flexWrap: 'wrap',
                justifyContent: 'center',
                alignItems: 'flex-start',
                maxWidth: '1200px',
                width: '100%'
            }}>
                {games.map((game) => (
                    <div
                        key={game.id}
                        onClick={() => handleGameClick(game.id)}
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            cursor: 'pointer',
                            transition: 'transform 0.2s ease',
                            padding: '20px',
                            borderRadius: '8px'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'scale(1.05)'
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'scale(1)'
                        }}
                    >
                        <div style={{
                            width: '200px',
                            height: '200px',
                            border: '3px solid #1a237e',
                            backgroundColor: '#f5f5f5',
                            borderRadius: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '20px',
                            marginBottom: '15px',
                            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                        }}>
                            <img
                                src={game.image}
                                alt={game.name}
                                style={{
                                    maxWidth: '100%',
                                    maxHeight: '100%',
                                    objectFit: 'contain',
                                    imageRendering: 'pixelated'
                                }}
                            />
                        </div>
                        <span style={{
                            fontSize: '1.2rem',
                            fontWeight: 'bold',
                            color: '#000000',
                            textAlign: 'center'
                        }}>
                            {game.name}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default Lending

