import { useEffect, useState } from 'react'

interface Ask {
  askId: string
  questions: string[]
}

/**
 * Global overlay: when a project run (with "ask me first" enabled) surfaces clarifying
 * questions, collect the user's answers and send them back so the run can start informed.
 */
export function QuestionModal(): JSX.Element | null {
  const [ask, setAsk] = useState<Ask | null>(null)
  const [answers, setAnswers] = useState<string[]>([])

  useEffect(() => {
    return window.api.onOrchestratorAsk((r) => {
      setAsk(r)
      setAnswers(r.questions.map(() => ''))
    })
  }, [])

  if (!ask) return null

  const finish = (payload: string[]) => {
    window.api.orchestratorAnswer(ask.askId, payload)
    setAsk(null)
  }

  return (
    <div className="tour-backdrop">
      <div className="tour-card" style={{ width: 'min(600px, 100%)' }}>
        <h2 style={{ marginTop: 0 }}>A few questions before I start</h2>
        <p className="small muted">
          Answering helps the agents build the right thing. Leave any blank to let them assume a sensible default.
        </p>
        {ask.questions.map((q, i) => (
          <div className="field" key={i}>
            <label>{q}</label>
            <input
              autoFocus={i === 0}
              value={answers[i] ?? ''}
              onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
            />
          </div>
        ))}
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button onClick={() => finish(ask.questions.map(() => ''))}>Skip</button>
          <div className="spacer" />
          <button className="primary" onClick={() => finish(answers)}>
            Start with these answers
          </button>
        </div>
      </div>
    </div>
  )
}
