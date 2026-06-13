import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, Output } from 'ai';
import { z } from 'zod';

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Mirrors the itinerary item shape used by the front-end (see Itinerary.jsx).
// Flight-specific fields (arrivalTime, airline, flightNumber, cost) are filled
// when the email is a flight confirmation; left empty otherwise.
const itemSchema = z.object({
  title: z.string().describe('Required. Short title like "Flight to Barcelona" or "Hotel Arts Barcelona"'),
  date: z.string().describe('YYYY-MM-DD format. The date the travel/lodging starts. Empty string if truly unknown.'),
  time: z.string().describe('HH:MM 24-hour format. Departure time for flights, check-in time for lodging. Empty string if none.'),
  location: z.string().describe('For travel items use "Origin → Destination" (e.g., "JFK Airport → Barcelona Airport"). For lodging use the place name and city. Empty string if none.'),
  notes: z.string().describe('Confirmation number, seat, terminal, room type, or other useful details. Empty string if none.'),
  type: z.enum(['activity', 'travel', 'lodging']).describe('"travel" for flights, trains, drives, transfers, car rentals; "lodging" for hotels, Airbnb, resorts; "activity" for tours, dining, reservations.'),
  isFlight: z.boolean().describe('true if this is an airline flight, false otherwise.'),
  arrivalTime: z.string().describe('HH:MM 24-hour arrival time for flights. Empty string if not a flight or unknown.'),
  airline: z.string().describe('Airline name for flights (e.g., "Delta", "United"). Empty string otherwise.'),
  flightNumber: z.string().describe('Flight number (e.g., "DL123"). Empty string otherwise.'),
  cost: z.string().describe('Total price if stated in the email (e.g., "450" or "$450" or "€380"). Empty string if not stated.'),
  tripId: z.string().describe('Airline/agency trip or itinerary ID if present (often labelled "Trip ID" or "Itinerary number"). Empty string if none.'),
  reservationNumber: z.string().describe('Booking / confirmation / reservation code (PNR), e.g. "ABC123". Empty string if none.'),
  fromLocation: z.string().describe('Departure airport/city for this leg (code or name), e.g. "JFK" or "New York JFK". Empty string if not a flight/transfer.'),
  toLocation: z.string().describe('Arrival airport/city for this leg, e.g. "BCN" or "Barcelona BCN". Empty string if not a flight/transfer.'),
  endDate: z.string().describe('YYYY-MM-DD arrival/end date when it differs from the start date or is explicitly stated (overnight flight, hotel check-out). Empty string if same as start date or unknown.'),
  passengers: z.string().describe('Comma-separated passenger names on the booking. Empty string if none.'),
  ticketNumbers: z.string().describe('Comma-separated airline ticket numbers (e.g. "0062345678901"). Empty string if none.'),
  seatNumbers: z.string().describe('Comma-separated seat assignments (e.g. "12A, 12B"). Empty string if none.'),
  bookingId: z.string().describe('For lodging: the hotel/agency booking ID or itinerary number (e.g. Booking.com "Booking number"). Empty string if none.'),
  hotelName: z.string().describe('For lodging: the property name (e.g. "Hotel Arts Barcelona"). Empty string if not lodging.'),
  guests: z.string().describe('For lodging: number of guests, or guest names if that is all that is stated (e.g. "2" or "2 adults"). Empty string if none.'),
  roomType: z.string().describe('For lodging: the room type/description (e.g. "King Room", "Deluxe Double"). Empty string if none.'),
  url: z.string().describe('Booking/management URL if present in the email, else empty string.'),
  imageQuery: z.string().describe('2-4 word image search query for lodging/activities (e.g., "hotel arts barcelona"). Empty string for flights/transfers.'),
});

const responseSchema = z.object({
  items: z.array(itemSchema).describe('Every travel and lodging item found in the email. Empty array if none found.'),
  message: z.string().describe('Short human-readable summary of what was extracted, e.g., "Found 1 flight and 1 hotel."'),
});

const SYSTEM_PROMPT = `You extract travel and lodging details from a pasted email (typically a confirmation from an airline, hotel, train, or car-rental company) and turn them into structured itinerary items.

Rules:
- Read the raw email text and pull out every flight, train, transfer, car rental, and lodging booking it describes.
- Each leg of a trip is its own item. A round-trip flight is TWO items (outbound and return). A multi-leg/connecting flight is one item per leg unless the email clearly bundles them.
- Use type "travel" for flights, trains, drives, transfers, car rentals. Use type "lodging" for hotels, Airbnb, resorts. Use type "activity" only for dining/tour/event reservations.
- For flights: set isFlight=true, fill airline, flightNumber, time (departure, local), arrivalTime (local), and format location as "Origin → Destination" using airport names or codes (e.g., "JFK → BCN" or "New York JFK → Barcelona BCN"). Also fill fromLocation (origin) and toLocation (destination) separately.
- Capture booking identifiers when present: tripId (trip/itinerary ID), reservationNumber (confirmation/PNR code), passengers (all traveller names), ticketNumbers, and seatNumbers. Leave any of these empty if the email does not state them. Never invent them.
- Set endDate when a leg ends on a different calendar day than it starts (e.g. an overnight/red-eye flight) or when the email explicitly states an arrival/check-out date; otherwise leave it empty.
- For lodging: set type "lodging"; date = check-in date, endDate = check-out date, time = check-in time if stated, location = hotel name + city. Also fill hotelName (property name), bookingId (booking/itinerary number), reservationNumber (confirmation code if separate from bookingId), guests (number of guests), and roomType. Leave any of these empty if the email does not state them.
- Always resolve dates to absolute YYYY-MM-DD. If the email only gives a weekday or "tomorrow", use the email's own date context to resolve it; if you cannot determine the year, assume the next occurrence relative to the trip context provided.
- Put confirmation/booking numbers in notes.
- Only include the cost if a price is explicitly stated in the email. Never invent prices.
- If the email contains no travel or lodging information, return an empty items array and say so in the message.
- Never fabricate flight numbers, times, or confirmation numbers. Leave a field as an empty string if the email does not contain it.
- The returned items will be ADDED to the user's existing itinerary, so do not return their existing items.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { emailText, eventContext } = req.body || {};
  if (!emailText || typeof emailText !== 'string' || !emailText.trim()) {
    return res.status(400).json({ error: 'Missing email text' });
  }

  // Guard against pathologically large pastes.
  const trimmed = emailText.slice(0, 20000);
  const eventContextText = eventContext ? JSON.stringify(eventContext, null, 2) : '(none)';

  const userMessage = `Trip context (for resolving relative dates and locations):
${eventContextText}

Pasted email:
"""
${trimmed}
"""

Extract all travel and lodging items from the email above.`;

  try {
    const { output } = await generateText({
      model: anthropic('claude-sonnet-4-6'),
      system: SYSTEM_PROMPT,
      prompt: userMessage,
      output: Output.object({ schema: responseSchema }),
    });

    return res.status(200).json(output);
  } catch (err) {
    console.error('parse-travel-email error:', err);
    return res.status(500).json({ error: err.message || 'Failed to parse email' });
  }
}
