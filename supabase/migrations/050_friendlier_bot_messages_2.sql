-- Segunda tanda de textos del bot más cercanos (aprobados por el propietario el 10/11/2026):
-- confirmar, cancelar, retomar/descartar, categoría inexistente, vinculación y renovación.
-- Solo cambia textos de respuesta: misma lógica, mismos controles y mismos permisos.
-- Cada texto anterior debe existir exactamente en la función indicada; si no, aborta sin cambios.
begin;

do $migration$
declare
 targets text[] := array['apply_whatsapp_job','confirm_draft_group','register_subscription_renewal'];
 fn_name text; fn oid; def text; i integer;
 olds text[]; news text[];
begin
 foreach fn_name in array targets loop
  if (select count(*) from pg_proc where proname=fn_name and pronamespace='public'::regnamespace)<>1 then
   raise exception 'BOT_MESSAGES_2_FUNCTION_UNEXPECTED %', fn_name;
  end if;
  select oid into fn from pg_proc where proname=fn_name and pronamespace='public'::regnamespace;

  if fn_name='apply_whatsapp_job' then
   olds := array[
    $o$'¡Listo! Se guardaron '||(outcome->>'confirmed_movements')||' movimientos en tu cuenta de Pesito ✅💰'$o$,
    $o$'No pudimos guardar: '||(outcome->>'error')$o$,
    $o$'Se descartaron los movimientos pendientes 🗑️.'$o$,
    $o$'No tenés movimientos pendientes para guardar.'$o$,
    $o$'La lista cambió o había mensajes en procesamiento. Revisá el próximo resumen y respondé CONFIRMAR nuevamente.'$o$,
    $o$'Tenés una lista de hace más de 24 horas. Respondé RETOMAR o DESCARTAR. Conservé este mensaje para procesarlo después.'$o$,
    $o$'Retomamos tu lista. Voy a procesar los mensajes que quedaron en espera.'$o$,
    $o$'Lista anterior descartada. Voy a procesar los mensajes que quedaron en espera.'$o$,
    $o$'¡Listo! Tu WhatsApp quedó vinculado con Pesito ✅'$o$,
    $o$'El código de vinculación no es válido o ya venció. Generá uno nuevo desde la app.'$o$,
    $o$'No encontré esa categoría activa para este gasto o ingreso. Usá una de tus categorías de la app. No modifiqué la lista.'$o$];
   news := array[
    $n$case when (outcome->>'confirmed_movements')='1' then E'¡Listo! Guardé 1 movimiento ✅\nLo ves en la app cuando quieras.' else '¡Listo! Guardé '||(outcome->>'confirmed_movements')||E' movimientos ✅\nLos ves en la app cuando quieras.' end$n$,
    $n$E'No pude guardar la lista 😕\n'||(outcome->>'error')$n$,
    $n$E'Listo, descarté la lista 🗑️\nNo se guardó nada.'$n$,
    $n$E'No tenés nada para guardar 👌\nMandame un gasto o ingreso cuando quieras.'$n$,
    $n$E'Tu lista cambió mientras tanto 🤔\nMirá el resumen que te mando y respondé *CONFIRMAR* de nuevo.'$n$,
    $n$E'Tenés una lista de hace más de un día 🕒\nRespondé RETOMAR para seguir con ella o DESCARTAR para empezar de cero.\n\nTu último mensaje lo guardé y lo proceso después.'$n$,
    $n$E'¡Retomamos tu lista! 👍\nAhora proceso los mensajes que quedaron en espera.'$n$,
    $n$E'Listo, descarté la lista anterior 🗑️\nAhora proceso los mensajes que quedaron en espera.'$n$,
    $n$E'¡Listo! Tu WhatsApp quedó vinculado con Pesito ✅\nYa podés mandarme tus gastos e ingresos, por ejemplo:\n👉 "Gasté 1500 en súper"'$n$,
    $n$E'Ese código no es válido o ya venció 🤔\nGenerá uno nuevo desde la app, en Ajustes.'$n$,
    $n$E'No encontré esa categoría 🤔\nUsá una de las categorías de la app, por ejemplo:\n👉 "el 2 categoría Salud"'$n$];
  elsif fn_name='confirm_draft_group' then
   olds := array[
    $o$'Usuario no encontrado.'$o$,
    $o$'Tu cuenta se encuentra en pausa.'$o$,
    $o$'Tu suscripción en Pesito ha finalizado.'$o$,
    $o$'El grupo de movimientos pendiente no existe.'$o$,
    $o$'Esta lista ya fue confirmada anteriormente.'$o$,
    $o$'Esta lista ya fue descartada.'$o$,
    $o$'La lista no está abierta.'$o$,
    $o$'El borrador fue actualizado concurrentemente. Por favor revisá el resumen más reciente antes de confirmar.'$o$,
    $o$'Hay movimientos con datos faltantes. Por favor completalos o quitalos antes de confirmar.'$o$,
    $o$'No hay movimientos pendientes para guardar.'$o$,
    $o$'hubo un problema técnico al registrar las operaciones. Tu lista pendiente se conserva intacta; probá confirmar nuevamente en unos momentos.'$o$];
   news := array[
    $n$'No encontré tu lista. Escribí RESUMEN para verla.'$n$,
    $n$'Tu cuenta está en pausa. Escribile a soporte para reactivarla.'$n$,
    $n$'Tu suscripción terminó. Escribile a soporte para renovarla.'$n$,
    $n$'No encontré tu lista. Escribí RESUMEN para verla.'$n$,
    $n$'Esta lista ya se había guardado antes.'$n$,
    $n$'Esta lista ya se había descartado.'$n$,
    $n$'Esta lista ya no está abierta. Escribí RESUMEN para ver la actual.'$n$,
    $n$'Tu lista cambió mientras tanto. Mirá el resumen y respondé *CONFIRMAR* de nuevo.'$n$,
    $n$'Hay movimientos con datos faltantes. Completalos o sacalos y respondé *CONFIRMAR*.'$n$,
    $n$'No hay movimientos para guardar.'$n$,
    $n$'Hubo un problema técnico. Tu lista sigue igual: probá *CONFIRMAR* de nuevo en un rato.'$n$];
  else
   olds := array[
    $o$'Tu número no está vinculado a esa cuenta. Revisá el vínculo desde Ajustes.'$o$,
    $o$'Tu cuenta está pausada. Contactá al administrador antes de renovar.'$o$,
    $o$'Tu cuenta ya tiene acceso sin vencimiento.'$o$,
    $o$'El bot está temporalmente pausado. Intentá más tarde.'$o$,
    $o$'Tu vínculo cambió. Pedile al administrador que revise el envío de tu código.'$o$,
    $o$'Tu pago ya está confirmado. Si el código estaba esperando la ventana de WhatsApp, lo enviaremos ahora. Canjealo en Ajustes de la app. Si no llegó, contactá al administrador.'$o$,
    $o$'Registré tu solicitud de renovación. El administrador verifica el pago y te envía por acá un código para canjear en Ajustes. La suscripción se renueva al canjearlo.'$o$,
    $o$E'\n\nAlias para transferencias: '$o$,
    $o$E'\nSoporte: https://wa.me/'$o$,
    $o$E'\nSi pasan 24 horas, volvé a escribir RENOVAR para habilitar el envío. No cargué movimientos de este mensaje.'$o$];
   news := array[
    $n$E'Tu número no está vinculado a esa cuenta.\nRevisá el vínculo en la app, en Ajustes.'$n$,
    $n$E'Tu cuenta está en pausa ⏸️\nEscribile al administrador antes de renovar.'$n$,
    $n$E'Tu cuenta no tiene vencimiento 🙌\nNo hace falta renovar.'$n$,
    $n$E'El bot está en mantenimiento por un rato 🛠️\nProbá de nuevo más tarde.'$n$,
    $n$E'Tu vínculo cambió 🤔\nPedile al administrador que revise el envío de tu código.'$n$,
    $n$E'Tu pago ya está confirmado ✅\nSi el código no te llegó, escribile al administrador. Se canjea en la app, en Ajustes.'$n$,
    $n$E'¡Listo! Registré tu pedido de renovación 👍\nCuando el administrador confirme tu pago, te mando por acá un código para canjear en la app.'$n$,
    $n$E'\n\n💳 Alias para transferir: '$n$,
    $n$E'\n💬 Soporte: https://wa.me/'$n$,
    $n$E'\nSi pasan 24 horas sin respuesta, escribí RENOVAR de nuevo.'$n$];
  end if;

  def := pg_get_functiondef(fn);
  for i in 1..array_length(olds,1) loop
   if position(olds[i] in def)=0 then
    raise exception 'BOT_MESSAGES_2_TEXT_MISSING % #%', fn_name, i;
   end if;
   def := replace(def, olds[i], news[i]);
  end loop;
  execute def;
 end loop;
end $migration$;

notify pgrst,'reload schema';
commit;
