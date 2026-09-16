const { requireAdmin, json } = require('./_admin');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  try {
    const auth = await requireAdmin(event);
    if (!auth.ok) return json(auth.statusCode, { error: auth.error });

    let input;
    try {
      input = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: 'Corps JSON invalide.' });
    }

    const id = Number(input.id);
    const statut = String(input.statut || '');
    if (!Number.isInteger(id) || !['Confirmé', 'Refusé', 'En attente'].includes(statut)) {
      return json(400, { error: 'Données invalides.' });
    }

    const { data, error } = await auth.supabase
      .from('reservations')
      .update({ statut, valide_par: auth.user.email })
      .eq('id', id)
      .select('id, nom_loueur, email, telephone, date_debut, date_fin, total_prix, total_caution, articles, statut, valide_par, pdf_url')
      .single();
    if (error) throw error;

    if (statut === 'Confirmé' && process.env.MAKE_CONFIRMATION_WEBHOOK) {
      fetch(process.env.MAKE_CONFIRMATION_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).catch(() => {});
    }

    return json(200, { reservation: data });
  } catch (error) {
    console.error('admin-statut:', error);
    return json(500, { error: 'Impossible de modifier le statut.' });
  }
};
