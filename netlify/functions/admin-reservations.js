const { requireAdmin, json } = require('./_admin');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method Not Allowed' });

  try {
    const auth = await requireAdmin(event);
    if (!auth.ok) return json(auth.statusCode, { error: auth.error });

    const { data, error } = await auth.supabase
      .from('reservations')
      .select('id, nom_loueur, email, telephone, date_debut, date_fin, total_prix, total_caution, articles, statut, valide_par, pdf_url')
      .order('date_debut', { ascending: true });
    if (error) throw error;

    return json(200, { reservations: data || [] });
  } catch (error) {
    console.error('admin-reservations:', error);
    return json(500, { error: 'Impossible de charger les réservations.' });
  }
};
