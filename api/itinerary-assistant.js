import { generateText, Output } from 'ai';
import { z } from 'zod';

const itemSchema = z.object({
  id: z.string().describe('Keep existing id when editing an item, or empty string for new items'),
  title: z.string().describe('Required. Short title like "Dinner at Le Bernardin"'),
  date: z.string().describe('YYYY-MM-DD format, or empty string if unscheduled'),
  time: z.string().describe('HH:MM 24-hour format, or empty string if no specific time'),
  location: z.string().describe('Empty string if none'),
  notes: z.string().describe('Empty string if none'),
  type: z.enum(['activity', 'travel', 'lodging']).describe('Category: "activity" for sightseeing, dining, tours; "travel" for flights, drives, transfers; "lodging" for hotels, Airbnb, accommodations'),
});

const responseSchema = z.object({
  action: z.enum(['replace', 'merge', 'add']).describe(
    '"replace" = returned items fully replace the current itinerary. "merge" = upsert by id (edit existing items by id, add new ones). "add" = append new items to the current list (no ids needed).'
  ),
  items: z.array(itemSchema),
  message: z.string().describe('Short human-readable confirmation of what you did'),
});

const SYSTEM_PROMPT = `You are an itinerary planning assistant. You help users build and modify trip itineraries through natural language.

Example instructions users might give:
- "Add dinner at 7pm on Friday at Sushi Nakazawa"
- "Move the museum visit to the morning"
- "Fill in Saturday with activities in Rome"
- "Remove the airport transfer"
- "Plan a day in Kyoto with 4-5 activities"

Rules:
- Infer sensible dates/times from context. If the user says "Friday" and the event spans multiple Fridays, pick the most likely one based on context.
- If editing an existing item, include its id from the current itinerary. Use action "merge".
- If adding a few new items without touching existing ones, use action "add" with no ids.
- If the user asks you to redo the whole itinerary, use action "replace".
- Never invent ids for new items — leave id as empty string "".
- Prefer specific, actionable items (e.g., "Breakfast at Cafe Madeleine" over "Morning activity").
- Categorize each item with the right type: "activity" for sightseeing, dining, tours, entertainment; "travel" for flights, drives, trains, transfers, car rentals; "lodging" for hotels, Airbnb, resorts, accommodations.
- When planning a full day or trip, always include travel and lodging items where appropriate (e.g., check-in/check-out times, flight arrivals/departures).`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, itinerary, eventContext } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  const currentItineraryText = Array.isArray(itinerary) && itinerary.length > 0
    ? JSON.stringify(itinerary, null, 2)
    : '(empty)';
  const eventContextText = eventContext ? JSON.stringify(eventContext, null, 2) : '(none)';

  const userMessage = `Event context:
${eventContextText}

Current itinerary:
${currentItineraryText}

User request:
${prompt}`;

  try {
    const { output } = await generateText({
      model: 'anthropic/claude-sonnet-4.6',
      system: SYSTEM_PROMPT,
      prompt: userMessage,
      output: Output.object({ schema: responseSchema }),
    });

    return res.status(200).json(output);
  } catch (err) {
    console.error('itinerary-assistant error:', err);
    return res.status(500).json({ error: err.message || 'Failed to generate itinerary update' });
  }
}
