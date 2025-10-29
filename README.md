# RUMCET

**ROM's Ultimate Manager, Conversion and Editor Tool**

A TypeScript/Electron application for managing, analyzing, and converting ROM collections based on DAT files (No-Intro, Redump, MAME).

## Features

- ✅ Parse DAT files (No-Intro, Redump, MAME)
- ✅ Scan ROM folders and archives (ZIP, 7Z, RAR, CHD)
- ✅ Match ROMs against DAT databases
- ✅ Identify useful vs unnecessary files
- ✅ Clean and convert ROM collections
- ✅ Support for various archive formats

## Supported Archive Formats

### Native Support (Always Available)
- **ZIP** - via adm-zip
- **7Z** - via node-7z / 7zip-bin
- **CHD** - MAME's compressed format

### Optional RAR Support
RAR archive support requires external tools installed by the user:
- **7-Zip** (free, recommended): https://www.7-zip.org
- **WinRAR** (paid): https://www.rarlab.com
- **unrar** (Linux/Mac): Available in most package managers

The application will automatically detect and use these tools if available.

**Note**: Previous versions included unRAR as a dependency. This was removed to ensure full open-source license compatibility (AGPL v3).

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/rumcet.git
cd rumcet

# Install dependencies
npm install

# Build and run
npm run clean && npm run build && npm start
```

## Usage

1. **Select a DAT file** (No-Intro, Redump, or MAME)
2. **Create/Select a database** (.sqlite file)
3. **Load DAT file** in the database
4. **Add ROM folders** to scan
5. **Analyze** ROMs against the DAT database
6. **Clean and convert** your collection

## Development

```bash
# Watch mode for development
npm run dev

# Clean build directory
npm run clean

# Build project
npm run build

# Run the application
npm start
```

## Project Structure

```
rumcet/
├── src/
│   ├── database/           # Initialize and populate database
│   ├── helpers/            # Tools
│   ├── main/               # Electron main process
│   │   ├── handlers/       # IPC Handlers
│   │   ├── services/       # Services
│   │   └── utils/          # Utils
│   ├── renderer/           # UI/Frontend
│   └── types/              # Shared types
├── dist/                   # Compiled output
├── resources/              # Binary resources
├── package.json
├── preload.json
├── tsconfig.json
└── tsconfig.preload.json
```

## License

**AGPL-3.0-or-later**

This program is free software: you can redistribute it and/or modify it under the terms of the **GNU Affero General Public License** as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but **WITHOUT ANY WARRANTY**; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.

### What does AGPL v3 mean?

- ✅ **Free to use** - Use the software for any purpose
- ✅ **Free to modify** - Adapt the code to your needs
- ✅ **Free to share** - Distribute the software
- ✅ **Source code access** - Always have access to the source
- ⚠️ **Network use = distribution** - If you run a modified version on a server, you must share your changes
- ⚠️ **Share-alike** - Derivative works must use AGPL v3

### Third-Party Licenses

This project uses third-party libraries with their own licenses:
- **adm-zip**: MIT License
- **node-7z**: MIT License
- **7zip-bin**: LGPL-3.0
- **sqlite3**: BSD-3-Clause
- **xml2js**: MIT License
- **electron**: MIT License
- **typescript**: Apache-2.0

All dependencies are compatible with AGPL v3.

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Ensure your code follows the existing style
5. Add your license header to new files (see LICENSE_HEADER.txt)
6. Submit a pull request

All contributions must be compatible with AGPL v3.

## Author

**Nanaki59**

## Support

For issues, questions, or feature requests, please open an issue on GitHub.

---

Made with ❤️ for the ROM preservation community
