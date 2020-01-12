package main

import (
	"encoding/csv"
	"fmt"
	"log"
	"os"
)

func main() {
	f, err := os.Open("tool/pali-reverse-trans-for-macro-table.csv")
	if err != nil {
		log.Fatal(err)
	}

	r := csv.NewReader(f)

	records, err := r.ReadAll()
	if err != nil {
		log.Fatal(err)
	}

	str := ""
	for _, record := range records {
		if record[2] == "" {
			continue
		}
		str += `"`
		str += record[2]
		str += `", "`
		str += record[3]
		str += `",`
	}
	fmt.Println(str)
}
