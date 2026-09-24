# Publication note — HRM Core 1.0.0

The first technical tag `hrm-core-1.0.0` pointed to commit `44e5f734e416faabadba8a7ab0bfd6c19b216d1d` and triggered an automated publication attempt. No GitHub Release was created: the verification job stopped before publication because Git line-ending normalization changed signed text bytes after checkout.

The preserved signed ZIP in the founder-controlled release staging area remained valid and was used to restore the exact signed bytes. The repository was then configured to treat `core/1.0.0/**` and its website mirror as binary/no-conversion content.

The canonical public release tag is therefore `hrm-core-1.0.0-signed`. The earlier tag is retained only as an audit trace of the aborted publication attempt and must not be used as the signed release reference.