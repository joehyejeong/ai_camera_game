import { supabase } from '../superbaseClient'

/**
 * 점수를 저장하고 최대 5개만 유지하는 함수
 * @param {number} score - 저장할 점수
 * @param {string} scoreColumn - 점수 컬럼명 ('score_1', 'score_2', 'score_3')
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const saveScore = async (score, scoreColumn) => {
    try {
        // 기존 점수들 가져오기 (내림차순 정렬)
        const { data: existingScores, error: fetchError } = await supabase
            .from('game')
            .select(`id, ${scoreColumn}`)
            .not(scoreColumn, 'is', null)
            .order(scoreColumn, { ascending: false })
            .limit(5)

        if (fetchError) {
            console.error('점수 조회 실패:', fetchError)
            return { success: false, error: fetchError.message }
        }

        // 동일한 점수가 이미 존재하는지 확인 (중복 방지)
        const duplicateExists = existingScores.some(item => item[scoreColumn] === score)
        if (duplicateExists) {
            console.log('동일한 점수가 이미 존재함, 저장하지 않음:', score)
            return { success: true, message: '동일한 점수가 이미 존재함' }
        }

        // 기존 점수가 5개 미만이거나, 새 점수가 5번째 점수보다 높으면 저장
        const shouldSave = existingScores.length < 5 ||
            (existingScores.length === 5 && score > existingScores[4][scoreColumn])

        if (!shouldSave) {
            console.log('점수가 top5에 들지 못함, 저장하지 않음')
            return { success: true, message: '점수가 top5에 들지 못함' }
        }

        // 새 점수 저장
        const { data: newScore, error: insertError } = await supabase
            .from('game')
            .insert([{ [scoreColumn]: score }])
            .select()

        if (insertError) {
            console.error('점수 저장 실패:', insertError)
            return { success: false, error: insertError.message }
        }

        // 기존 점수가 5개였고 새 점수가 추가되었다면, 가장 낮은 점수 삭제
        // 중요: 해당 scoreColumn만 null로 업데이트하여 다른 게임 점수는 보존
        if (existingScores.length === 5 && newScore && newScore.length > 0) {
            // 다시 조회하여 정확한 순서 확인 (해당 scoreColumn만 조회)
            const { data: allScores, error: reFetchError } = await supabase
                .from('game')
                .select(`id, ${scoreColumn}`)
                .not(scoreColumn, 'is', null)
                .order(scoreColumn, { ascending: false })
                .limit(6) // 6개 가져와서 가장 낮은 것 처리

            if (!reFetchError && allScores && allScores.length > 5) {
                // 가장 낮은 점수를 가진 레코드 찾기
                const lowestScore = allScores[allScores.length - 1]

                // 해당 레코드의 다른 게임 점수 확인
                const { data: fullRecord, error: fetchFullError } = await supabase
                    .from('game')
                    .select('id, score_1, score_2, score_3')
                    .eq('id', lowestScore.id)
                    .single()

                if (!fetchFullError && fullRecord) {
                    // 다른 게임 점수가 있는지 확인
                    const hasOtherScores =
                        (scoreColumn !== 'score_1' && fullRecord.score_1 !== null) ||
                        (scoreColumn !== 'score_2' && fullRecord.score_2 !== null) ||
                        (scoreColumn !== 'score_3' && fullRecord.score_3 !== null)

                    if (hasOtherScores) {
                        // 다른 게임 점수가 있으면 해당 컬럼만 null로 업데이트
                        const { error: updateError } = await supabase
                            .from('game')
                            .update({ [scoreColumn]: null })
                            .eq('id', lowestScore.id)

                        if (updateError) {
                            console.error('낮은 점수 업데이트 실패:', updateError)
                        }
                    } else {
                        // 다른 게임 점수가 없으면 레코드 전체 삭제
                        const { error: deleteError } = await supabase
                            .from('game')
                            .delete()
                            .eq('id', lowestScore.id)

                        if (deleteError) {
                            console.error('낮은 점수 삭제 실패:', deleteError)
                        }
                    }
                }
            }
        }

        return { success: true, data: newScore }
    } catch (error) {
        console.error('점수 저장 중 오류:', error)
        return { success: false, error: error.message }
    }
}

/**
 * 최고 점수를 가져오는 함수
 * @param {string} scoreColumn - 점수 컬럼명 ('score_1', 'score_2', 'score_3')
 * @returns {Promise<{success: boolean, highScore?: number, error?: string}>}
 */
export const getHighScore = async (scoreColumn) => {
    try {
        const { data, error } = await supabase
            .from('game')
            .select(scoreColumn)
            .not(scoreColumn, 'is', null)
            .order(scoreColumn, { ascending: false })
            .limit(1)
            .single()

        if (error) {
            // 데이터가 없을 수도 있음 (에러가 아닐 수 있음)
            if (error.code === 'PGRST116') {
                return { success: true, highScore: 0 }
            }
            console.error('최고 점수 조회 실패:', error)
            return { success: false, error: error.message }
        }

        return { success: true, highScore: data?.[scoreColumn] || 0 }
    } catch (error) {
        console.error('최고 점수 조회 중 오류:', error)
        return { success: false, error: error.message }
    }
}

/**
 * Top 5 점수를 가져오는 함수
 * @param {string} scoreColumn - 점수 컬럼명 ('score_1', 'score_2', 'score_3')
 * @returns {Promise<{success: boolean, topScores?: Array, error?: string}>}
 */
export const getTopScores = async (scoreColumn) => {
    try {
        const { data, error } = await supabase
            .from('game')
            .select(`id, ${scoreColumn}, created_at`)
            .not(scoreColumn, 'is', null)
            .order(scoreColumn, { ascending: false })
            .limit(5)

        if (error) {
            console.error('Top 점수 조회 실패:', error)
            return { success: false, error: error.message }
        }

        return { success: true, topScores: data || [] }
    } catch (error) {
        console.error('Top 점수 조회 중 오류:', error)
        return { success: false, error: error.message }
    }
}

