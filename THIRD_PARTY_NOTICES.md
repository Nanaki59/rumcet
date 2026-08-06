# Third-party notices

RUMCET is licensed under the AGPL-3.0-or-later. It interoperates with, and can
consume data from, the third-party projects listed below. RUMCET is not affiliated
with any of them, and does not redistribute their data: files are downloaded by the
user, at the user's request, from a source the user can change in the settings.

---

## Retool clone lists and metadata

- **Project**: [retool-clonelists-metadata](https://github.com/unexpectedpanda/retool-clonelists-metadata)
- **Author**: unexpectedpanda
- **Licence**: BSD-3-Clause
- **Used for**: the JSON format of the clone lists read by
  `src/helpers/cloneLists.ts`, and the default source URL offered in
  *Settings → Consolidation → 1G1R*.

Clone lists record which titles are the same game published under different names
depending on the region — a relation that cannot be derived from the title text and
that RUMCET therefore consumes rather than computes.

RUMCET implements only a subset of the format (`group`, `titles[].searchTerm`,
`titles[].nameType`, `titles[].categories`). It is an independent reader, not a port
of Retool, and it is neither endorsed by nor affiliated with the Retool project.

The upstream application is no longer maintained; the data repository has continued
to receive updates. Because the source is a setting, RUMCET can be pointed at a fork
or a local mirror without any code change.

```
BSD 3-Clause License

Copyright (c) unexpectedpanda

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## DAT files

DAT files (No-Intro, Redump, MAME, Pleasuredome, Progetto Snaps) remain the property
of their respective projects. RUMCET reads them and never redistributes them; the
user obtains them from the sources configured in the application.

The naming conventions parsed by `src/shared/romNaming/` are those documented by
No-Intro and Redump.
