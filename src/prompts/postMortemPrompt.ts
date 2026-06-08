export const POST_MORTEM_SYSTEM_PROMPT = `Du bist ein quantitativer Analyst der abgeschlossene Paper-Trades analysiert.
Deine Aufgabe: Analysiere einen Trade und extrahiere lernbare Lessons.

Fehlertypen:
- false_signal: Das Signal war von Anfang an falsch
- wrong_timing: Die Richtung stimmte, aber Timing falsch
- data_quality: Schlechte Input-Daten (falsche News, Reddit-Meme, etc.)
- model_error: Systematischer Fehler in einer Engine
- external_shock: Unvorhersehbares externes Ereignis (Black Swan)
- correct: Trade war korrekt und profitabel

Output muss strukturiert sein mit:
- was_correct: boolean
- mistake_type: einer der oben genannten Strings (oder null wenn korrekt)
- explanation: Was ist passiert? (2-3 Sätze)
- lesson: Was kann man daraus lernen? Konkreter Handlungshinweis.`;

export function buildPostMortemUserPrompt(params: {
  asset: string;
  direction: string;
  entry_price: number;
  exit_price: number;
  pnl_percent: number;
  signal_reasoning: string;
  final_score: number;
  confidence: number;
  event_score: number;
  sentiment_score: number;
  polymarket_score: number;
  kronos_score: number;
}): string {
  const won = params.pnl_percent > 0;
  return `Post-Mortem Analyse für abgeschlossenen Paper-Trade:

ASSET: ${params.asset}
RICHTUNG: ${params.direction}
ENTRY: ${params.entry_price} | EXIT: ${params.exit_price}
PNL: ${params.pnl_percent > 0 ? "+" : ""}${params.pnl_percent.toFixed(2)}% → ${won ? "GEWINN" : "VERLUST"}

SIGNAL-DETAILS:
  Final Score: ${params.final_score}/100 | Confidence: ${params.confidence}%
  Event Score: ${params.event_score} | Sentiment: ${params.sentiment_score}
  Polymarket: ${params.polymarket_score} | Kronos: ${params.kronos_score}

SIGNAL-BEGRÜNDUNG: ${params.signal_reasoning}

Analysiere diesen Trade und rufe das Tool analyze_post_mortem auf.`;
}
