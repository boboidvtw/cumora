# Shared by backup.sh and restore.sh (sourced, not run): how an off-site copy
# is encrypted. One place, so the two sides can never drift apart.
#
# An off-site copy is one file, cumora-YYYYMMDD-HHMMSS.tar.xz.enc: the backup
# folder as tar.xz, encrypted with AES-256-CBC and a PBKDF2 key from a
# passphrase kept in the login Keychain (service "cumora-backup"). The
# passphrase never touches disk or argv; it goes to openssl through the
# environment of that one process.
#
# Keep a copy of the passphrase somewhere other than this Mac (iCloud
# Keychain, a password manager). Without it the off-site copies cannot be
# opened, and losing this Mac is exactly when they are needed.
#
#   security find-generic-password -s cumora-backup -w   # show it

OFFSITE_KEYCHAIN_SERVICE=cumora-backup

offsite_passphrase() {
  security find-generic-password -s "$OFFSITE_KEYCHAIN_SERVICE" -a "$(id -un)" -w 2>/dev/null
}

# stdin -> stdout
offsite_encrypt() {
  CUMORA_OFFSITE_PASS=$(offsite_passphrase) || return 1
  [ -n "$CUMORA_OFFSITE_PASS" ] || return 1
  CUMORA_OFFSITE_PASS=$CUMORA_OFFSITE_PASS openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -salt \
    -pass env:CUMORA_OFFSITE_PASS
}

# stdin -> stdout
offsite_decrypt() {
  CUMORA_OFFSITE_PASS=$(offsite_passphrase) || return 1
  [ -n "$CUMORA_OFFSITE_PASS" ] || return 1
  CUMORA_OFFSITE_PASS=$CUMORA_OFFSITE_PASS openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 \
    -pass env:CUMORA_OFFSITE_PASS
}
