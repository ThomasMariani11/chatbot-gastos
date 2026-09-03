import type { FinancialProposal } from '../types';

type GeminiInput = { text?: string; mediaBase64?: string; mimeType?: string };

const responseJsonSchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['expense', 'income'] },
    description: { type: 'string' },
    totalAmountArs: { type: ['number', 'null'] },
    occurredOn: { type: ['string', 'null'] },
    category: { type: ['string', 'null'] },
    installments: { type: 'integer', minimum: 1, maximum: 60 },
    firstInstallmentMonth: { type: ['string', 'null'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    missingFields: { type: 'array', items: { type: 'string', enum: ['amount', 'date', 'category'] } },
  },
  required: ['kind', 'description', 'totalAmountArs', 'occurredOn', 'category', 'installments', 'firstInstallmentMonth', 'confidence', 'missingFields'],
};

export async function extractFinancialProposal(input: GeminiInput): Promise<FinancialProposal> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini no está configurado.');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const prompt = `Fecha local: ${today}. Extraé una sola operación financiera argentina. Interpretá “lucas” y “k” como miles de ARS. Si la fecha no está expresada, usá la fecha local. Categorías de gasto: Alimentación, Transporte, Vivienda, Servicios, Salud, Educación, Ocio, Compras, Impuestos, Deudas, Otros. Categorías de ingreso: Sueldo, Freelance, Ventas, Rendimientos, Otros. ${input.text ?? ''}`;
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (input.mediaBase64 && input.mimeType) parts.push({ inlineData: { mimeType: input.mimeType, data: input.mediaBase64 } });
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', responseJsonSchema, temperature: 0.1 } }),
  });
  if (!response.ok) throw new Error(`Gemini respondió ${response.status}.`);
  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const raw = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Gemini no devolvió una propuesta.');
  return JSON.parse(raw) as FinancialProposal;
}
