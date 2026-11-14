#!/usr/bin/env bash
# KariaEjderha derleme: javac + jar (Maven/Gradle gerekmez). VM'de ~/minecraft/kaynak/ejderha içinde çalışır.
set -e
cd "$(dirname "$0")"
CP=$(find ~/minecraft/libraries -name "*.jar" | tr "\n" ":")
rm -rf build && mkdir -p build
javac -nowarn --release 21 -encoding UTF-8 -cp "$CP" -d build $(find src/main/java -name "*.java")
cp -r src/main/resources/. build/
(cd build && jar --create --file ../KariaEjderha.jar .)
echo "KariaEjderha.jar hazır: $(du -h KariaEjderha.jar | cut -f1)"
