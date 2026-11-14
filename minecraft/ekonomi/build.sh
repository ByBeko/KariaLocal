#!/usr/bin/env bash
# KariaEkonomi derleme: Java 21 JDK gerekir. Bağımlılıklar lib/ altına indirilir (depoya girmez).
# Çıktı: build/KariaEkonomi.jar
set -euo pipefail
cd "$(dirname "$0")"

JAVA_HOME="${JAVA_HOME:-$(ls -d "/c/Program Files/Eclipse Adoptium/jdk-21"* 2>/dev/null | head -1)}"
JAVAC="$JAVA_HOME/bin/javac"
JAR="$JAVA_HOME/bin/jar"

mkdir -p lib
if [ ! -f lib/spigot-api.jar ]; then
  B=https://hub.spigotmc.org/nexus/content/repositories/snapshots/org/spigotmc/spigot-api/1.21.1-R0.1-SNAPSHOT
  V=$(curl -s "$B/maven-metadata.xml" | grep -o '<value>[^<]*</value>' | head -1 | sed 's/<[^>]*>//g')
  curl -sfL -o lib/spigot-api.jar "$B/spigot-api-$V.jar"
fi
[ -f lib/vault-api.jar ] || curl -sfL -o lib/vault-api.jar https://jitpack.io/com/github/MilkBowl/VaultAPI/1.7.1/VaultAPI-1.7.1.jar

rm -rf build && mkdir -p build/classes
SEP=":"; case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) SEP=";";; esac
"$JAVAC" --release 21 -proc:none -encoding UTF-8 -Xlint:-options \
  -cp "lib/spigot-api.jar${SEP}lib/vault-api.jar" \
  -d build/classes $(find src/main/java -name '*.java')
cp src/main/resources/* build/classes/
"$JAR" --create --file build/KariaEkonomi.jar -C build/classes .
echo "build/KariaEkonomi.jar hazır"
