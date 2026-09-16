const { createClient } = require('@supabase/supabase-js');

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  },
  body: JSON.stringify(body)
});

const cleanText = (value, max = 200) => String(value || '').trim().slice(0, max);
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: 'Configuration serveur incomplète.' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let input;
  try {
    input = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Corps JSON invalide.' });
  }

  // Honeypot anti-bot : le champ doit rester vide.
  if (input.website) return json(400, { error: 'Requête invalide.' });

  const nom = cleanText(input.nom_loueur, 120);
  const adresse = cleanText(input.adresse, 180);
  const cp = cleanText(input.cp, 12);
  const ville = cleanText(input.ville, 120);
  const email = cleanText(input.email, 180).toLowerCase();
  const telephone = cleanText(input.telephone, 40);
  const dateDebut = cleanText(input.date_debut, 10);
  const dateFin = cleanText(input.date_fin, 10);
  const articlesDemandes = Array.isArray(input.articles) ? input.articles : [];
  const pdfBase64 = String(input.pdf_base64 || '');

  if (!nom || !adresse || !cp || !ville || !email || !telephone) {
    return json(400, { error: 'Tous les champs de contact sont obligatoires.' });
  }
  if (!validEmail(email)) return json(400, { error: 'Adresse e-mail invalide.' });
  if (!validDate(dateDebut) || !validDate(dateFin) || dateFin < dateDebut) {
    return json(400, { error: 'Période de location invalide.' });
  }
  const today = new Date().toISOString().slice(0, 10);
  if (dateDebut < today) return json(400, { error: 'La date de début ne peut pas être passée.' });
  if (!articlesDemandes.length || articlesDemandes.length > 50) {
    return json(400, { error: 'Le panier est vide ou invalide.' });
  }
  if (!pdfBase64 || pdfBase64.length > 8_000_000) {
    return json(400, { error: 'Contrat PDF manquant ou trop volumineux.' });
  }

  const normalized = [];
  for (const article of articlesDemandes) {
    const id = Number(article.id);
    const qty = Number(article.qty);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 100) {
      return json(400, { error: 'Article ou quantité invalide.' });
    }
    const existing = normalized.find((a) => a.id === id);
    if (existing) existing.qty += qty;
    else normalized.push({ id, qty });
  }

  try {
    const ids = normalized.map((a) => a.id);
    const { data: materiels, error: matError } = await supabase
      .from('materiels')
      .select('id, nom, prix, caution_unitaire, stock_total')
      .in('id', ids);
    if (matError) throw matError;
    if (!materiels || materiels.length !== ids.length) {
      return json(400, { error: 'Un ou plusieurs matériels sont introuvables.' });
    }

    const { data: reservations, error: resError } = await supabase
      .from('reservations')
      .select('articles, statut')
      .lte('date_debut', dateFin)
      .gte('date_fin', dateDebut)
      .neq('statut', 'Refusé');
    if (resError) throw resError;

    const articles = [];
    let totalPrix = 0;
    let totalCaution = 0;

    for (const wanted of normalized) {
      const mat = materiels.find((m) => Number(m.id) === wanted.id);
      let dejaReserve = 0;
      for (const reservation of reservations || []) {
        const found = Array.isArray(reservation.articles)
          ? reservation.articles.find((a) => Number(a.id) === wanted.id)
          : null;
        if (found) dejaReserve += Number(found.qty) || 0;
      }

      const disponible = Number(mat.stock_total) - dejaReserve;
      if (wanted.qty > disponible) {
        return json(409, {
          error: `Stock insuffisant pour ${mat.nom}.`,
          materiel_id: wanted.id,
          disponible: Math.max(0, disponible)
        });
      }

      const prix = Number(mat.prix) || 0;
      const caution = Number(mat.caution_unitaire) || 0;
      totalPrix += wanted.qty * prix;
      totalCaution += wanted.qty * caution;
      articles.push({
        id: wanted.id,
        nom: mat.nom,
        qty: wanted.qty,
        prix,
        caution_unitaire: caution
      });
    }

    const safeName = nom.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'client';
    const fileName = `contrat_${Date.now()}_${safeName}.pdf`;
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer.length || pdfBuffer.slice(0, 4).toString() !== '%PDF') {
      return json(400, { error: 'Le fichier transmis n’est pas un PDF valide.' });
    }

    const { error: uploadError } = await supabase.storage
      .from('contrats')
      .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: false });
    if (uploadError) throw uploadError;

    const { data: inserted, error: insertError } = await supabase
      .from('reservations')
      .insert([{
        nom_loueur: nom,
        adresse,
        cp,
        ville,
        email,
        telephone,
        date_debut: dateDebut,
        date_fin: dateFin,
        total_prix: Number(totalPrix.toFixed(2)),
        total_caution: Number(totalCaution.toFixed(2)),
        pdf_url: fileName,
        articles,
        statut: 'En attente'
      }])
      .select('id')
      .single();
    if (insertError) {
      await supabase.storage.from('contrats').remove([fileName]);
      throw insertError;
    }

    const { data: signed } = await supabase.storage
      .from('contrats')
      .createSignedUrl(fileName, 60 * 60 * 24 * 7);

    if (process.env.MAKE_RESERVATION_WEBHOOK) {
      fetch(process.env.MAKE_RESERVATION_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reservation_id: inserted.id,
          client: nom,
          email,
          telephone,
          dates: `du ${dateDebut} au ${dateFin}`,
          montant: Number(totalPrix.toFixed(2)),
          caution: Number(totalCaution.toFixed(2)),
          articles
        })
      }).catch(() => {});
    }

    return json(201, {
      message: 'Réservation enregistrée.',
      reservation_id: inserted.id,
      total_prix: Number(totalPrix.toFixed(2)),
      total_caution: Number(totalCaution.toFixed(2)),
      contract_url: signed?.signedUrl || null
    });
  } catch (error) {
    console.error('reserver:', error);
    return json(500, { error: 'Impossible d’enregistrer la réservation.' });
  }
};
