import { CirclePlus } from "lucide-react";

import { AdminCustomVoicesClient } from "../../../features/admin/custom-voices/admin-custom-voices-client";

export default function AdminCustomVoicesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="mt-1 rounded-xl border border-violet-400/25 bg-violet-500/10 p-2 text-violet-200">
          <CirclePlus className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-3xl font-semibold text-white">Свои голоса</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Добавляйте и удаляйте голоса вручную — они появятся в каталоге у пользователей (вместе с каталогом Secret
            Voicer). Превью можно указать ссылкой или загрузить аудиофайлом. Удаление также сбрасывает MP3-превью в
            таблице превью для этого voiceId.
          </p>
        </div>
      </div>
      <AdminCustomVoicesClient />
    </div>
  );
}
