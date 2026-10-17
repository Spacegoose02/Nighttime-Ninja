# Home Assistant

Nighttime Ninja exposes a small API that Home Assistant can read with its built-in `rest` integration.

## 1. Create a token

In Nighttime Ninja go to **Settings → Home → Home Assistant and automations**, name a token (for example “Home Assistant”), and copy it. Only home managers can do this. Tokens can read and update that one home but can't manage members or delete anything big.

You'll also need your home's API address. It's shown right under the token box in Settings. Test it with:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://YOUR_SERVER:8080/api/homes/YOUR_HOME_ID/ha/summary
```


## 2. Add to `secrets.yaml`

```yaml
nighttime_ninja_auth: "Bearer nnk_your_token_here"
```

## 3. Add sensors to `configuration.yaml`

```yaml
rest:
  - resource: http://YOUR_SERVER:8080/api/homes/YOUR_HOME_ID/ha/summary
    headers:
      Authorization: !secret nighttime_ninja_auth
    scan_interval: 300
    sensor:
      - name: "Kitchen tonight"
        unique_id: nighttime_ninja_tonight
        icon: mdi:silverware-fork-knife
        value_template: "{{ value_json.tonight or 'Nothing planned' }}"
        json_attributes:
          - todays_meals
      - name: "Shopping list"
        unique_id: nighttime_ninja_shopping
        icon: mdi:cart
        unit_of_measurement: items
        value_template: "{{ value_json.shopping_count }}"
        json_attributes:
          - shopping
      - name: "Pantry running low"
        unique_id: nighttime_ninja_low_stock
        icon: mdi:alert
        unit_of_measurement: items
        value_template: "{{ value_json.low_stock_count }}"
        json_attributes:
          - low_stock
          - expiring_soon
      - name: "Ready to cook"
        unique_id: nighttime_ninja_ready
        icon: mdi:chef-hat
        unit_of_measurement: recipes
        value_template: "{{ value_json.ready_to_cook_count }}"
        json_attributes:
          - ready_to_cook

rest_command:
  nighttime_ninja_add:
    url: http://YOUR_SERVER:8080/api/homes/YOUR_HOME_ID/shopping
    method: POST
    headers:
      Authorization: !secret nighttime_ninja_auth
      Content-Type: application/json
    payload: '{"text": "{{ item }}"}'
```

## 4. Use it

Add to the list from a script, automation, or voice assistant:

```yaml
action: rest_command.nighttime_ninja_add
data:
  item: "2 lb chicken, milk"
```

Example automation: announce dinner at 5 PM.

```yaml
automation:
  - alias: Announce dinner
    triggers:
      - trigger: time
        at: "17:00:00"
    conditions:
      - condition: not
        conditions:
          - condition: state
            entity_id: sensor.kitchen_tonight
            state: Nothing planned
    actions:
      - action: tts.speak
        target:
          entity_id: tts.home_assistant_cloud
        data:
          media_player_entity_id: media_player.kitchen
          message: "Tonight's dinner is {{ states('sensor.kitchen_tonight') }}."
```

## API reference

Every route below accepts `Authorization: Bearer <token>`.

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/homes/{id}/ha/summary` | |
| GET | `/api/homes/{id}/shopping` | |
| POST | `/api/homes/{id}/shopping` | `{"text": "2 lb chicken, milk"}` |
| PATCH | `/api/homes/{id}/shopping/{itemId}` | `{"checked": true}` |
| GET | `/api/homes/{id}/items` | `?low=true` for low stock |
| POST | `/api/homes/{id}/items/{itemId}/adjust` | `{"delta": -1}` |
| GET | `/api/homes/{id}/mealplan?start=YYYY-MM-DD&days=7` | |
