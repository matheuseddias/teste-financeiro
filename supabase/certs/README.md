# Autoridades públicas do Supabase

Certificados públicos oficiais, sem chaves privadas, obtidos da CLI do Supabase via HTTPS no commit `703afc860284dc9203d816eff4d0893f6f9c1c97`:

- [2021](https://github.com/supabase/cli/blob/703afc860284dc9203d816eff4d0893f6f9c1c97/apps/cli/src/commands/gen/types/templates/prod-ca-2021.ts): SHA256 `807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`.
- [2025](https://github.com/supabase/cli/blob/703afc860284dc9203d816eff4d0893f6f9c1c97/apps/cli-go/internal/gen/types/templates/prod-ca-2025.crt): SHA256 `5F9B77951A7AA1303F9B58EEA9BFA89E358CFDC15F9786FF10D4930A722C9AE2`.

O workflow combina estas autoridades com o conjunto confiável do Ubuntu e usa `PGSSLROOTCERT`. `sslmode=verify-full` continua obrigatório. Não trocar certificados apenas para fazer uma conexão passar: confirmar sempre a origem oficial e a rotação publicada pelo provedor.
