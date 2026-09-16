const { createClient } = require('@supabase/supabase-js');

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method Not Allowed' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: 'Configuration serveur incomplète.' });
  }

  const { debut = '', fin = '' } = event.queryStringParameters || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(debut) || !/^\d{4}-\d{2}-\d{2}$/.test(fin) || fin < debut) {
    return json(400, { error: 'Période invalide.' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    const [{ data: materiels, error: matError }, { data: reservations, error: resError }] = await Promise.all([
      supabase.from('materiels').select('id, stock_total'),
      supabase.from('reservations')
        .select('articles, statut')
        .lte('date_debut', fin)
        .gte('date_fin', debut)
        .neq('statut', 'Refusé')
    ]);
    if (matError) throw matError;
    if (resError) throw resError;

    const reserves = new Map();
    for (const reservation of reservations || []) {
      if (!Array.isArray(reservation.articles)) continue;
      for (const article of reservation.articles) {
        const id = Number(article.id);
        const qty = Number(article.qty) || 0;
        if (!Number.isFinite(id) || qty <= 0) continue;
        reserves.set(id, (reserves.get(id) || 0) + qty);
      }
    }

    const disponibilites = Object.fromEntries((materiels || []).map((m) => {
      const id = Number(m.id);
      const dispo = Math.max(0, Number(m.stock_total || 0) - (reserves.get(id) || 0));
      return [String(id), dispo];
    }));

    return json(200, { disponibilites });
  } catch (error) {
    console.error('disponibilites:', error);
    return json(500, { error: 'Impossible de calculer les disponibilités.' });
  }
};
