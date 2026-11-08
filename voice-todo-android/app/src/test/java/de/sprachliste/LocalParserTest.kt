package de.sprachliste

import de.sprachliste.ai.LocalParser
import de.sprachliste.ai.TaskExtractor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.LocalTime

class LocalParserTest {
    private val today = LocalDate.of(2026, 11, 8) // Sonntag

    @Test fun heuteDuschen() {
        val r = LocalParser.parse("Ich möchte heute duschen gehen", today)
        assertEquals(1, r.size)
        assertEquals("Duschen gehen", r[0].title)
        assertEquals(today, r[0].date)
        assertNull(r[0].time)
    }

    @Test fun mehrereAufgabenMitZeit() {
        val r = LocalParser.parse("Ich muss heute noch einkaufen und dann morgen um 10 Uhr Mama anrufen", today)
        assertEquals(2, r.size)
        assertEquals("Einkaufen", r[0].title)
        assertEquals(today, r[0].date)
        assertEquals("Mama anrufen", r[1].title)
        assertEquals(today.plusDays(1), r[1].date)
        assertEquals(LocalTime.of(10, 0), r[1].time)
    }

    @Test fun wochentagUndAbends() {
        val r = LocalParser.parse("am Freitag um 7 abends ins Kino", today)
        assertEquals("Ins Kino", r[0].title)
        assertEquals(LocalDate.of(2026, 11, 13), r[0].date)
        assertEquals(LocalTime.of(19, 0), r[0].time)
    }

    @Test fun halbAcht() {
        val r = LocalParser.parse("morgen um halb acht joggen", today)
        assertEquals("Joggen", r[0].title)
        assertEquals(LocalTime.of(7, 30), r[0].time)
    }

    @Test fun festesDatum() {
        val r = LocalParser.parse("Zahnarzt am 3.12. um 14:30", today)
        assertEquals("Zahnarzt", r[0].title)
        assertEquals(LocalDate.of(2026, 12, 3), r[0].date)
        assertEquals(LocalTime.of(14, 30), r[0].time)
    }

    @Test fun ohneDatum() {
        val r = LocalParser.parse("Fahrrad reparieren", today)
        assertEquals("Fahrrad reparieren", r[0].title)
        assertNull(r[0].date)
    }

    @Test fun kiAntwortWirdGelesen() {
        val raw = """Hier: {"tasks":[{"title":"Duschen gehen","date":"2026-11-08","time":null,"durationMin":15,"notes":""},
            {"title":"Arzt","date":"2026-11-09","time":"09:00","durationMin":60,"notes":"Versichertenkarte"}]}"""
        val r = TaskExtractor.parseJson(raw)
        assertEquals(2, r.size)
        assertEquals("Duschen gehen", r[0].title); assertNull(r[0].time)
        assertEquals(LocalTime.of(9, 0), r[1].time); assertEquals("Versichertenkarte", r[1].notes)
    }
}
