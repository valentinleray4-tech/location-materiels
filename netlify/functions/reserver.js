const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  // On récupère les clés SECRÈTES enregistrées dans Netlify
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const donnees = JSON.parse(event.body);

  try {
    const { data, error } = await supabase
      .from('reservations')
      .insert([donnees]);

    if (error) throw error;

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Réservation réussie !", data }),
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
