require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const db      = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────
//  ROOMS
// ─────────────────────────────────────────────

// GET all rooms
app.get('/api/rooms', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM rooms ORDER BY room_number');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update room status
app.put('/api/rooms/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['Available', 'Booked', 'Maintenance'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    await db.query('UPDATE rooms SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ message: 'Room updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
//  GUESTS
// ─────────────────────────────────────────────

// GET all guests
app.get('/api/guests', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM guests ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST add a guest
app.post('/api/guests', async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
    const [result] = await db.query(
      'INSERT INTO guests (name, email, phone) VALUES (?, ?, ?)',
      [name, email, phone || null]
    );
    res.status(201).json({ id: result.insertId, name, email, phone });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Guest with this email already exists' });
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
//  BOOKINGS
// ─────────────────────────────────────────────

// GET all bookings (with room + guest info via JOIN)
app.get('/api/bookings', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        b.id, b.check_in, b.check_out, b.total_amount, b.status, b.created_at,
        r.room_number, r.type   AS room_type, r.price_per_night,
        g.name                  AS guest_name,
        g.email                 AS guest_email,
        g.phone                 AS guest_phone
      FROM bookings b
      JOIN rooms  r ON b.room_id  = r.id
      JOIN guests g ON b.guest_id = g.id
      ORDER BY b.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create a new booking
app.post('/api/bookings', async (req, res) => {
  try {
    const { room_id, guest_id, check_in, check_out } = req.body;
    if (!room_id || !guest_id || !check_in || !check_out)
      return res.status(400).json({ error: 'All fields are required' });

    // Validate room exists and is available
    const [rooms] = await db.query('SELECT * FROM rooms WHERE id = ?', [room_id]);
    if (!rooms.length)           return res.status(404).json({ error: 'Room not found' });
    if (rooms[0].status !== 'Available') return res.status(400).json({ error: 'Room is not available' });

    // Calculate nights & total
    const nights = Math.ceil(
      (new Date(check_out) - new Date(check_in)) / (1000 * 60 * 60 * 24)
    );
    if (nights <= 0) return res.status(400).json({ error: 'Check-out must be after check-in' });

    const total = nights * parseFloat(rooms[0].price_per_night);

    const [result] = await db.query(
      'INSERT INTO bookings (room_id, guest_id, check_in, check_out, total_amount) VALUES (?, ?, ?, ?, ?)',
      [room_id, guest_id, check_in, check_out, total]
    );

    // Mark room as Booked
    await db.query("UPDATE rooms SET status = 'Booked' WHERE id = ?", [room_id]);

    res.status(201).json({ id: result.insertId, total_amount: total, nights });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT cancel or check-out a booking
app.put('/api/bookings/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['Confirmed', 'Cancelled', 'Checked Out'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const [bookings] = await db.query('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
    if (!bookings.length) return res.status(404).json({ error: 'Booking not found' });

    await db.query('UPDATE bookings SET status = ? WHERE id = ?', [status, req.params.id]);

    // Free the room when cancelled or checked out
    if (status === 'Cancelled' || status === 'Checked Out') {
      await db.query("UPDATE rooms SET status = 'Available' WHERE id = ?", [bookings[0].room_id]);
    }

    res.json({ message: `Booking marked as ${status}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏨  Grand Vista Hotel API`);
  console.log(`   Running → http://localhost:${PORT}`);
  console.log(`   Press Ctrl+C to stop\n`);
});
