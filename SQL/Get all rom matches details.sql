SELECT	*
FROM	rom_matches rm
INNER JOIN	dat_roms dr
	ON	rm.dat_rom_id	=	dr.id
LEFT OUTER JOIN	scanned_files sf
	ON	rm.scanned_file_id	=	sf.id
LEFT OUTER JOIN	archive_contents ac
	ON	rm.archive_content_id	=	ac.id
LEFT OUTER JOIN	scanned_files sf2
	ON	ac.archive_id	=	sf2.id
WHERE	scanned_file_id	IS NOT NULL
	OR	archive_content_id	IS NOT NULL