const { requireAdmin, json } = require('./_admin');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method Not Allowed' });

  try {
    const auth = await requireAdmin(event);
    if (!auth.ok) return json(auth.statusCode, { error: auth.error });

    const id = Number(event.queryStringParameters?.id);
    if (!Number.isInteger(id)) return json(400, { error: 'Identifiant invalide.' });

    const { data: reservation, error } = await auth.supabase
      .from('reservations')
      .select('pdf_url')
      .eq('id', id)
      .single();
    if (error) throw error;
    if (!reservation?.pdf_url) return json(404, { error: 'Contrat introuvable.' });

    const { data: signed, error: signedError } = await auth.supabase.storage
      .from('contrats')
      .createSignedUrl(reservation.pdf_url, 60 * 15);
    if (signedError) throw signedError;

    return json(200, { url: signed.signedUrl });
  } catch (error) {
    console.error('admin-contrat:', error);
    return json(500, { error: 'Impossible d’ouvrir le contrat.' });
  }
};
